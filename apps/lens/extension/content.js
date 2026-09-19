// StudiO content script
// - Extracts study content from any page
// - Responds to postMessage from the StudiO app (when user clicks "Analyze all")

// Idempotency guard — this script can be injected both via manifest
// content_scripts AND via chrome.scripting.executeScript on demand.
// Without this guard the runtime.onMessage listener would register
// multiple times and sendResponse would fire more than once.
if (window.__studioContentLoaded) {
  // already loaded, do nothing
} else {
  window.__studioContentLoaded = true;

(function () {
  const STUDIO_ORIGINS = [
    "https://studystudio.us",
    "https://www.studystudio.us",
    "https://study-o-two.vercel.app",
    "http://localhost:3000",
    "https://localhost:3000",
  ];

  // ── Content extraction ─────────────────────────────────────────

  function detectSourceType(url) {
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
    if (url.includes("brightspace") || url.includes("d2l")) return "brightspace";
    if (url.endsWith(".pdf") || url.includes(".pdf?")) return "pdf";
    return "webpage";
  }

  function extractPageContent() {
    const clone = document.cloneNode(true);
    const removeSelectors = [
      "script",
      "style",
      "nav",
      "footer",
      "header",
      "aside",
      "iframe",
      "noscript",
      "svg",
      ".sidebar",
      "#sidebar",
      "[role='navigation']",
      "[role='banner']",
      "[role='contentinfo']",
    ];
    removeSelectors.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });

    const mainEl =
      clone.querySelector("main") ||
      clone.querySelector("article") ||
      clone.querySelector('[role="main"]') ||
      clone.querySelector(".content") ||
      clone.querySelector("#content") ||
      clone.body;

    return mainEl
      ? mainEl.textContent.replace(/\s+/g, " ").trim().slice(0, 15000)
      : "";
  }

  function extractYouTubeInfo() {
    const title = document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
    const descEl = document.querySelector(
      "#description-inline-expander, #description ytd-text-inline-expander, ytd-watch-metadata #description"
    );
    const description = descEl ? descEl.textContent.trim() : "";
    // Note: the StudiO server auto-pulls the full transcript server-side
    // via youtube-transcript. We send the description as a fallback.
    return { title, content: description || extractPageContent() };
  }

  function extractBrightspaceContent() {
    const title = document.title.trim();
    const contentFrame =
      document.querySelector(".d2l-page-main") ||
      document.querySelector("[role='main']") ||
      document.body;
    const content = contentFrame
      ? contentFrame.textContent.replace(/\s+/g, " ").trim().slice(0, 15000)
      : extractPageContent();
    return { title, content };
  }

  function extractContent() {
    const url = window.location.href;
    const sourceType = detectSourceType(url);
    let title, content;

    if (sourceType === "youtube") {
      const yt = extractYouTubeInfo();
      title = yt.title;
      content = yt.content;
    } else if (sourceType === "brightspace") {
      const bs = extractBrightspaceContent();
      title = bs.title;
      content = bs.content;
    } else {
      title = document.title.trim();
      content = extractPageContent();
    }

    return { url, title, content, sourceType };
  }

  // Returns true if the extension context is still alive. After the user
  // reloads/updates the extension, previously-injected content scripts become
  // "orphaned" — chrome.runtime is still present but calling into it throws
  // "Extension context invalidated". Guard every chrome.* call with this.
  function extAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function safeSendRuntime(msg, cb) {
    if (!extAlive()) return;
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        // Swallow lastError so it doesn't surface as an uncaught error
        void chrome.runtime.lastError;
        if (cb) cb(resp);
      });
    } catch {
      /* context invalidated between check and call */
    }
  }

  // ── postMessage bridge ─────────────────────────────────────────
  // When the StudiO web app clicks "Analyze all," it posts a message
  // asking all tabs for their content. The extension's background
  // worker actually queries tabs — but we also listen here on the
  // StudiO app page itself to forward requests via runtime messaging.

  if (STUDIO_ORIGINS.some((o) => window.location.origin === o)) {
    // We're inside the StudiO web app — bridge postMessage → extension background
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "studio-app") return;
      if (!extAlive()) return; // orphaned content script — do nothing

      if (data.type === "REQUEST_TABS") {
        safeSendRuntime(
          { type: "QUERY_ALL_TABS", requestId: data.requestId },
          (response) => {
            window.postMessage(
              {
                source: "studio-extension",
                type: "TABS_RESPONSE",
                requestId: data.requestId,
                tabs: (response && response.tabs) || [],
              },
              "*"
            );
          }
        );
      }

      if (data.type === "ACTIVE_SESSION" && data.sessionId) {
        // Forward the dashboard's current sessionId to the background worker,
        // so captures land in the session the user is actually viewing.
        // `groupShareCode` is set when the active session is a group session,
        // so "Open StudiO" can route back to the group page (not the
        // personal dashboard) and the captured source stays in context.
        safeSendRuntime({
          type: "SET_ACTIVE_SESSION",
          sessionId: data.sessionId,
          groupShareCode: data.groupShareCode || null,
        });
      }
    });

    // Signal presence to the app
    if (extAlive()) {
      window.postMessage(
        { source: "studio-extension", type: "READY", version: "1.0.0" },
        "*"
      );
    }
  }

  // ── chrome.runtime message handlers (from background or popup) ─

  if (extAlive()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!extAlive()) return false;
      if (message.type === "EXTRACT_CONTENT") {
        const data = extractContent();
        sendResponse(data);
        return false; // sync
      }
      if (message.type === "PING") {
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "NOTIFY_SOURCE_CAPTURED") {
        // Only forward on the StudiO app origin — Bootstrap.tsx is listening.
        if (STUDIO_ORIGINS.some((o) => window.location.origin === o)) {
          window.postMessage(
            {
              source: "studio-extension",
              type: "SOURCE_CAPTURED",
              sessionId: message.sessionId || null,
            },
            window.location.origin
          );
        }
        sendResponse({ ok: true });
        return false;
      }
    });
  }
})();

} // end idempotency guard
