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

// ═══════════════════════════════════════════════════════════════════
// LENS Guide — goal-aware screen walkthrough
// ═══════════════════════════════════════════════════════════════════
//
// You give it a goal ("launch a t3.micro EC2 instance"). It screenshots
// the visible tab, asks /api/guide/step what the next move is, and has
// content.js draw a ring over the real control on the real page. When you
// click, or when the page navigates, it looks again and advances.
//
// Three things in here are load-bearing and easy to break:
//
//   1. THE OVERLAY IS HIDDEN BEFORE EVERY CAPTURE. captureVisibleTab
//      photographs the composited page, our ring included. Leave it up and
//      the model sees its own last bubble and starts pointing at it.
//   2. ONE STEP IN FLIGHT AT A TIME. A click storm would otherwise fire a
//      Computer Use call per click, and the answers arrive out of order —
//      the ring lands on a screen that has already gone.
//   3. THE DOWNSCALE DECLARES ITS OWN SIZE. Same rule as
//      hooks/usePointer.ts: the image's real pixel dimensions and the
//      resolution declared to the tool have to be the same number.
//      captureVisibleTab returns a Retina-sized image, so this is not
//      optional — skip it and every coordinate comes back at half scale.

// Mirror of SUPPORTED_RESOLUTIONS in lib/pointer.ts. Kept in sync by hand
// because a service worker can't import from the Next app.
const GUIDE_RESOLUTIONS = [
  { width: 1024, height: 768, aspect: 1024 / 768 },
  { width: 1280, height: 800, aspect: 1280 / 800 },
  { width: 1366, height: 768, aspect: 1366 / 768 },
];

function guideBestResolution(w, h) {
  const aspect = w / Math.max(1, h);
  let best = GUIDE_RESOLUTIONS[1];
  let diff = Number.POSITIVE_INFINITY;
  for (const r of GUIDE_RESOLUTIONS) {
    const d = Math.abs(aspect - r.aspect);
    if (d < diff) {
      diff = d;
      best = r;
    }
  }
  return { width: best.width, height: best.height };
}

const GUIDE_DEFAULT = {
  active: false,
  goal: "",
  history: [],
  tabId: null,
  sessionId: null,
  last: null, // the most recent GuideStep
  thinking: false,
  error: null,
};

// In-memory mirror so the hot path doesn't await storage on every click.
// chrome.storage is still the source of truth across worker restarts.
let guideState = { ...GUIDE_DEFAULT };
let guideInFlight = false;
let guidePendingTimer = null;

async function loadGuideState() {
  const { guide } = await chrome.storage.local.get("guide");
  guideState = { ...GUIDE_DEFAULT, ...(guide || {}) };
  return guideState;
}

async function saveGuideState(patch) {
  guideState = { ...guideState, ...patch };
  await chrome.storage.local.set({ guide: guideState });
  return guideState;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendToTab(tabId, message) {
  try {
    await ensureContentScript(tabId);
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null; // tab closed, restricted page, or no content script
  }
}

/** Base64 without FileReader — btoa is available in a service worker. */
async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000; // chunked: String.fromCharCode blows the stack on big buffers
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Screenshot the visible viewport with our own overlay taken down, then
 * redraw it at exactly the resolution we intend to declare.
 * Returns null when the tab can't be captured (restricted page, closed).
 */
async function captureForGuide(tab) {
  // 1. Overlay down. The content script answers with its viewport size in
  //    CSS pixels, which is what the coordinates get rescaled back to.
  const hidden = await sendToTab(tab.id, {
    type: "GUIDE_SET_OVERLAY_VISIBLE",
    visible: false,
  });
  // One frame for the compositor to actually drop it before we photograph.
  await sleep(60);

  let rawDataUrl;
  try {
    rawDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 90,
    });
  } catch (err) {
    await sendToTab(tab.id, { type: "GUIDE_SET_OVERLAY_VISIBLE", visible: true });
    throw new Error(
      "Chrome wouldn't screenshot this tab — Guide can't run on chrome:// or Web Store pages."
    );
  }

  await sendToTab(tab.id, { type: "GUIDE_SET_OVERLAY_VISIBLE", visible: true });

  // 2. Downscale to a declared resolution. See note 3 in the header.
  const blob = await (await fetch(rawDataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const declared = guideBestResolution(bitmap.width, bitmap.height);

  const canvas = new OffscreenCanvas(declared.width, declared.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, declared.width, declared.height);
  bitmap.close();

  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  const base64 = await blobToBase64(out);

  return {
    image: `data:image/jpeg;base64,${base64}`,
    declared,
    // CSS-pixel viewport when the content script could tell us, otherwise
    // the raw bitmap — never the downscaled size, which would flatten the
    // rescale into a no-op and hide a Retina bug.
    capture:
      hidden && hidden.width && hidden.height
        ? { width: hidden.width, height: hidden.height }
        : { width: bitmap.width, height: bitmap.height },
  };
}

/**
 * Run one turn. `reason` is only for logging — it tells you whether this
 * fired from a click, a navigation, or the student pressing Start.
 */
async function runGuideStep(reason = "manual") {
  if (!guideState.active) return null;
  if (guideInFlight) return null; // note 2 in the header
  guideInFlight = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("No active tab to look at.");

    await saveGuideState({ thinking: true, error: null, tabId: tab.id });
    await sendToTab(tab.id, { type: "GUIDE_THINKING" });

    const shot = await captureForGuide(tab);
    const base = await getApiBase();

    const res = await fetch(`${base}/api/guide/step`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: guideState.goal,
        image: shot.image,
        declaredWidth: shot.declared.width,
        declaredHeight: shot.declared.height,
        captureWidth: shot.capture.width,
        captureHeight: shot.capture.height,
        history: guideState.history,
        pageUrl: tab.url || null,
        pageTitle: tab.title || null,
        sessionId: guideState.sessionId || null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `LENS API error ${res.status}`);
    }

    const data = await res.json();
    const step = data.step;

    // Only steps that actually advanced the walkthrough go in the history.
    // Re-reads of a screen we already described would otherwise pile up and
    // teach the model it has been going in circles.
    const history =
      step.status === "on_track" || step.status === "done"
        ? [...guideState.history, step.step]
        : guideState.history;

    await saveGuideState({
      thinking: false,
      last: step,
      history,
      sessionId: data.sessionId || guideState.sessionId,
      // A finished goal stops the loop; the card stays up until dismissed.
      active: step.status !== "done",
    });

    await sendToTab(tab.id, { type: "GUIDE_SHOW", step, goal: guideState.goal });
    return step;
  } catch (err) {
    const message = err && err.message ? err.message : "Guide step failed";
    await saveGuideState({ thinking: false, error: message });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) await sendToTab(tab.id, { type: "GUIDE_ERROR", error: message });
    return null;
  } finally {
    guideInFlight = false;
  }
}

/**
 * Re-look after the student does something. Debounced, because a click
 * that triggers a navigation arrives as a click AND an onUpdated, and
 * because capturing mid-render gets us a screenshot of a spinner.
 */
function scheduleGuideStep(reason, delay = 900) {
  if (!guideState.active) return;
  if (guidePendingTimer) clearTimeout(guidePendingTimer);
  guidePendingTimer = setTimeout(() => {
    guidePendingTimer = null;
    runGuideStep(reason);
  }, delay);
}

async function startGuide(goal) {
  await loadGuideState();
  await saveGuideState({
    ...GUIDE_DEFAULT,
    active: true,
    goal,
    // Carry the session across goals so the whole walkthrough is one
    // LENS session rather than an orphan per goal.
    sessionId: guideState.sessionId,
  });
  return runGuideStep("start");
}

async function stopGuide() {
  if (guidePendingTimer) {
    clearTimeout(guidePendingTimer);
    guidePendingTimer = null;
  }
  const tabId = guideState.tabId;
  await saveGuideState({ ...GUIDE_DEFAULT, sessionId: guideState.sessionId });
  if (tabId) await sendToTab(tabId, { type: "GUIDE_CLEAR" });
  // Any tab may still be showing a ring from an earlier step.
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((t) => (t.id ? sendToTab(t.id, { type: "GUIDE_CLEAR" }) : null))
  );
}

// ── Guide message handling ──────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type || !message.type.startsWith("GUIDE_")) return;

  if (message.type === "GUIDE_START" && message.goal) {
    startGuide(String(message.goal).slice(0, 500))
      .then((step) => sendResponse({ success: true, step }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "GUIDE_STOP") {
    stopGuide()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.type === "GUIDE_GET_STATE") {
    loadGuideState()
      .then((state) => sendResponse({ success: true, state }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Student clicked something, or asked for another look.
  if (message.type === "GUIDE_ADVANCE") {
    loadGuideState().then(() => scheduleGuideStep(message.reason || "click"));
    sendResponse({ success: true });
    return false;
  }

  // "I did it but nothing's highlighted" — re-look immediately.
  if (message.type === "GUIDE_RELOOK") {
    loadGuideState().then(() => scheduleGuideStep("relook", 0));
    sendResponse({ success: true });
    return false;
  }
});

// A navigation means the previous ring describes a page that is gone.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  // An event can wake a torn-down worker before the bottom-of-file
  // loadGuideState() has resolved, so re-read before trusting the mirror.
  await loadGuideState();
  if (!guideState.active) return;
  if (guideState.tabId && tabId !== guideState.tabId) return;
  // Longer than a click: SPA consoles keep painting well after "complete".
  scheduleGuideStep("navigation", 1400);
});

// Clear a stale ring when the student switches away mid-walkthrough.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await loadGuideState();
  if (!guideState.active) return;
  if (guideState.tabId && tabId !== guideState.tabId) {
    await sendToTab(guideState.tabId, { type: "GUIDE_CLEAR" });
  }
});

// The service worker is torn down when idle; rehydrate on every wake.
loadGuideState();
