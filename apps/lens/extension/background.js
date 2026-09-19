// StudiO background service worker

// User-configurable: change to your deployed StudiO URL in chrome.storage
const DEFAULT_API = "https://studystudio.us";

async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get("apiBase");
  return apiBase || DEFAULT_API;
}

// Anything on http/https is fair game EXCEPT obvious non-study domains like
// email, social, shopping, messaging, streaming, cloud consoles, etc.
// We also tag a known-study subset with a specific sourceType for richer
// server-side handling (YouTube transcripts, Brightspace, PDFs).
const STUDY_URL_PATTERNS = [
  /youtube\.com\/watch/i,
  /youtu\.be\//i,
  /brightspace/i,
  /\bd2l\b/i,
  /canvas\./i,
  /blackboard/i,
  /coursera/i,
  /edx\.org/i,
  /khanacademy/i,
  /\.pdf(\?|$)/i,
  /wikipedia\.org/i,
  /arxiv\.org/i,
  /docs\.google\.com\/document/i,
  /notion\.so/i,
  /github\.com\/.*\/(?:README|docs|wiki)/i,
];

const NON_STUDY_HOST_PATTERNS = [
  /^(mail|inbox)\.google\./i,
  /outlook\.(live|office)\.com/i,
  /mail\.yahoo\./i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)snapchat\.com$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)pinterest\.com$/i,
  /(^|\.)whatsapp\.com$/i,
  /(^|\.)messenger\.com$/i,
  /(^|\.)discord\.com$/i,
  /(^|\.)slack\.com$/i,
  /(^|\.)teams\.microsoft\.com$/i,
  /(^|\.)zoom\.us$/i,
  /(^|\.)amazon\./i,
  /(^|\.)ebay\./i,
  /(^|\.)etsy\./i,
  /(^|\.)netflix\.com$/i,
  /(^|\.)hulu\.com$/i,
  /(^|\.)spotify\.com$/i,
  /(^|\.)twitch\.tv$/i,
  /(^|\.)paypal\.com$/i,
  /(^|\.)stripe\.com$/i,
  /(^|\.)chatgpt\.com$/i,
  /(^|\.)openai\.com$/i,
  /(^|\.)claude\.ai$/i,
  /(^|\.)gemini\.google\.com$/i,
  // StudiO itself
  /(^|\.)localhost$/i,
];

function looksLikeStudy(url) {
  if (!url) return false;
  // Protocol filter
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname;
    // Skip blacklisted hosts (email, social, shopping, streaming, etc.)
    if (NON_STUDY_HOST_PATTERNS.some((p) => p.test(host))) return false;
    // Skip homepages and search engines (low-value for study capture)
    const u = new URL(url);
    if (/^(www\.)?(google|bing|duckduckgo|yandex)\.[a-z.]+$/i.test(host) && u.pathname === "/") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Returns a specific source type for known study sites (for richer backend
// handling) or null for generic webpages — the server also infers this.
function classifyStudyUrl(url) {
  if (!url) return null;
  if (STUDY_URL_PATTERNS[0].test(url) || STUDY_URL_PATTERNS[1].test(url)) return "youtube";
  if (STUDY_URL_PATTERNS[2].test(url) || STUDY_URL_PATTERNS[3].test(url)) return "brightspace";
  if (STUDY_URL_PATTERNS[9].test(url)) return "pdf";
  return null;
}

// Ensure the content script is present in the tab before messaging.
// The manifest's content_scripts only auto-inject on NEW navigations, so
// tabs that were already open when the extension was installed/reloaded
// would otherwise throw "Receiving end does not exist".
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return true;
  } catch (err) {
    // Restricted pages (chrome://, webstore, PDFs in some cases) can't be injected.
    return false;
  }
}

async function extractTab(tabId) {
  try {
    await ensureContentScript(tabId);
    return await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: "EXTRACT_CONTENT" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  } catch (err) {
    // Content script not injected on this page (common on chrome:// or new tabs)
    return null;
  }
}

// ── chrome.runtime listener ─────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "QUERY_ALL_TABS") {
    queryAllStudyTabs()
      .then((tabs) => sendResponse({ success: true, tabs }))
      .catch((err) => sendResponse({ success: false, error: err.message, tabs: [] }));
    return true;
  }

  if (message.type === "CAPTURE_PAGE") {
    sendToStudiO(message.data)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "CAPTURE_ALL_TABS") {
    captureAllStudyTabs()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_STATUS") {
    fetchStatus()
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "OPEN_STUDIO") {
    openLENS()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.type === "SET_ACTIVE_SESSION" && message.sessionId) {
    // Track both the sessionId and (when applicable) the group shareCode.
    // The personal dashboard broadcasts with no shareCode — in that case
    // clear the previously-stored group code so "Open StudiO" routes to
    // /app instead of an old group page.
    chrome.storage.local.set({
      activeSessionId: message.sessionId,
      activeGroupShareCode: message.groupShareCode || null,
    });
    sendResponse({ success: true });
    return false;
  }
});

// ── Core actions ─────────────────────────────────────────────────

async function queryAllStudyTabs() {
  const base = await getApiBase();
  const studioOrigin = (() => {
    try { return new URL(base).origin; } catch { return null; }
  })();
  const allTabs = await chrome.tabs.query({});
  const candidates = allTabs.filter((t) => {
    if (!looksLikeStudy(t.url)) return false;
    // Don't capture the StudiO app itself
    if (studioOrigin && t.url && t.url.startsWith(studioOrigin)) return false;
    return true;
  });

  // Extract in parallel (bounded) — sequential was noticeably slow with many tabs.
  const CONCURRENCY = 4;
  const results = [];
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const extracted = await Promise.all(batch.map((t) => extractTab(t.id)));
    extracted.forEach((e, idx) => {
      if (e && e.content && e.content.length > 50) {
        // Override sourceType when we have a specific classification
        const hint = classifyStudyUrl(batch[idx].url);
        if (hint) e.sourceType = hint;
        results.push(e);
      }
    });
  }
  return results;
}

async function captureAllStudyTabs() {
  const tabs = await queryAllStudyTabs();
  let captured = 0;
  let failed = 0;
  // Sequential POSTs so we don't hammer the server; each capture may trigger
  // an expensive server-side fetch (YouTube transcript, etc.).
  for (const tab of tabs) {
    try {
      await sendToStudiO(tab);
      captured += 1;
    } catch (err) {
      console.warn("[StudiO] capture failed for", tab.url, err);
      failed += 1;
    }
  }
  return { captured, failed, total: tabs.length };
}

async function sendToStudiO(pageData) {
  const base = await getApiBase();
  const { activeSessionId } = await chrome.storage.local.get("activeSessionId");
  const res = await fetch(`${base}/api/sources/capture`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: pageData.url,
      title: pageData.title,
      content: pageData.content,
      sourceType: pageData.sourceType || null,
      sessionId: activeSessionId || null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `StudiO API error ${res.status}`);
  }
  const data = await res.json();
  // Pin future captures (and "Open StudiO") to the session the server actually
  // used — this way every capture from the extension lands in the same chat,
  // even when no StudiO tab is open to broadcast ACTIVE_SESSION.
  if (data && data.sessionId) {
    await chrome.storage.local.set({ activeSessionId: data.sessionId });
  }
  notifyLENSTabs(base).catch(() => {});
  return data;
}

// Find open StudiO tabs and tell their content script to postMessage the
// "SOURCE_CAPTURED" event into the page. Bootstrap.tsx listens for this
// and re-fetches the session's sources.
async function notifyLENSTabs(base) {
  try {
    const origin = new URL(base).origin;
    const { activeSessionId } = await chrome.storage.local.get("activeSessionId");
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    await Promise.all(
      tabs.map(async (tab) => {
        if (!tab.id) return;
        await ensureContentScript(tab.id);
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "NOTIFY_SOURCE_CAPTURED",
            sessionId: activeSessionId || null,
          });
        } catch {
          /* tab may have been closed */
        }
      })
    );
  } catch {
    /* ignore */
  }
}

async function fetchStatus() {
  const base = await getApiBase();
  const res = await fetch(`${base}/api/status`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

// Open or focus the StudiO app. If an app tab is already open, focus it and
// have it switch to the captured session. Otherwise open a new tab on
// /app?session=<id> so bootstrap resumes that chat directly. When the
// active session is a group session we route to /app/group/<shareCode>.
async function openLENS() {
  const base = await getApiBase();
  const { activeSessionId, activeGroupShareCode } =
    await chrome.storage.local.get(["activeSessionId", "activeGroupShareCode"]);
  const origin = new URL(base).origin;

  const targetUrl = activeGroupShareCode
    ? `${base}/app/group/${encodeURIComponent(activeGroupShareCode)}`
    : activeSessionId
    ? `${base}/app?session=${encodeURIComponent(activeSessionId)}`
    : `${base}/app`;

  // Prefer focusing an existing tab that already points at the target URL
  // (e.g. the user just minimized it). Match by pathname so query/hash
  // differences don't cause us to open duplicates.
  const targetPath = new URL(targetUrl).pathname;
  const allAppTabs = await chrome.tabs.query({ url: `${origin}/app*` });
  const exactTab = allAppTabs.find((t) => {
    try {
      return new URL(t.url || "").pathname === targetPath;
    } catch {
      return false;
    }
  });
  if (exactTab && exactTab.id != null) {
    await chrome.tabs.update(exactTab.id, { active: true });
    if (exactTab.windowId) {
      await chrome.windows.update(exactTab.windowId, { focused: true });
    }
    // Ask the page to refresh its sources after the capture
    if (activeSessionId) {
      try {
        await ensureContentScript(exactTab.id);
        await chrome.tabs.sendMessage(exactTab.id, {
          type: "NOTIFY_SOURCE_CAPTURED",
          sessionId: activeSessionId,
        });
      } catch {
        /* ignore */
      }
    }
    return;
  }

  // If a personal /app tab is open but we want a group page (or vice versa),
  // open a new tab at the correct URL rather than hijacking the existing one.
  await chrome.tabs.create({ url: targetUrl });
}
