// LENS content script
// - Extracts study content from any page
// - Responds to postMessage from the LENS app (when user clicks "Analyze all")

// Idempotency guard — this script can be injected both via manifest
// content_scripts AND via chrome.scripting.executeScript on demand.
// Without this guard the runtime.onMessage listener would register
// multiple times and sendResponse would fire more than once.
if (window.__lensContentLoaded) {
  // already loaded, do nothing
} else {
  window.__lensContentLoaded = true;

(function () {
  const LENS_ORIGINS = [
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
    // Note: the LENS server auto-pulls the full transcript server-side
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
  // When the LENS web app clicks "Analyze all," it posts a message
  // asking all tabs for their content. The extension's background
  // worker actually queries tabs — but we also listen here on the
  // LENS app page itself to forward requests via runtime messaging.

  if (LENS_ORIGINS.some((o) => window.location.origin === o)) {
    // We're inside the LENS web app — bridge postMessage → extension background
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "lens-app") return;
      if (!extAlive()) return; // orphaned content script — do nothing

      if (data.type === "REQUEST_TABS") {
        safeSendRuntime(
          { type: "QUERY_ALL_TABS", requestId: data.requestId },
          (response) => {
            window.postMessage(
              {
                source: "lens-extension",
                type: "TABS_RESPONSE",
                requestId: data.requestId,
                tabs: (response && response.tabs) || [],
              },
              "*"
            );
          }
        );
      }

      // The voice agent's read_guide_step asks which session the guide is
      // writing its steps into (hooks/useAgent.ts, GUIDE_SESSION_REQUEST).
      // The guide runs in the background worker with a session of its own,
      // so without this answer the app reads its OWN session, finds no
      // guide_step events there, and tells the student "no walkthrough is
      // running" while a ring is on screen in the next tab.
      if (data.type === "GUIDE_SESSION_REQUEST" && data.requestId) {
        safeSendRuntime({ type: "GUIDE_GET_STATE" }, (response) => {
          const state = response && response.success ? response.state : null;
          window.postMessage(
            {
              source: "lens-extension",
              type: "GUIDE_SESSION",
              requestId: data.requestId,
              sessionId: state && state.sessionId ? state.sessionId : null,
              active: !!(state && state.active),
            },
            window.location.origin
          );
        });
      }

      if (data.type === "ACTIVE_SESSION" && data.sessionId) {
        // Forward the dashboard's current sessionId to the background worker,
        // so captures land in the session the user is actually viewing.
        // `groupShareCode` is set when the active session is a group session,
        // so "Open LENS" can route back to the group page (not the
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
        { source: "lens-extension", type: "READY", version: "1.0.0" },
        "*"
      );
    }
  }

  // ── LENS Guide overlay ─────────────────────────────────────────
  //
  // Draws the ring and the step card over the REAL page. Everything
  // lives in a shadow root attached to documentElement, for two reasons:
  // the page's CSS can't reach in and restyle us, and SPA frameworks that
  // replace document.body don't take the overlay with them.
  //
  // The host is pointer-events:none so the student can still click the
  // thing we are pointing at. Only the card's own buttons opt back in.

  const GUIDE_HOST_ID = "__lens-guide-overlay";
  let guideHost = null;
  let guideRoot = null;
  let guideVisible = true;

  const GUIDE_CSS = `
    :host { all: initial; }
    .layer {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .ring {
      position: fixed;
      width: 64px; height: 64px;
      margin: -32px 0 0 -32px;
      border-radius: 50%;
      border: 3px solid #a3e635;
      box-shadow: 0 0 0 3px rgba(163,230,53,.25), 0 0 26px rgba(163,230,53,.55);
      animation: lens-pulse 1.6s ease-out infinite;
      display: none;
    }
    .ring.on { display: block; }
    @keyframes lens-pulse {
      0%   { transform: scale(.72); opacity: 1; }
      70%  { transform: scale(1.18); opacity: .35; }
      100% { transform: scale(.72); opacity: 1; }
    }
    .dot {
      position: fixed;
      width: 10px; height: 10px;
      margin: -5px 0 0 -5px;
      border-radius: 50%;
      background: #a3e635;
      box-shadow: 0 0 12px rgba(163,230,53,.9);
      display: none;
    }
    .dot.on { display: block; }
    .card {
      position: fixed;
      max-width: 340px;
      pointer-events: auto;
      background: rgba(11,10,26,.97);
      color: #fff;
      border: 1px solid rgba(139,92,246,.35);
      border-radius: 14px;
      padding: 13px 14px 11px;
      box-shadow: 0 18px 50px rgba(0,0,0,.55);
      backdrop-filter: blur(8px);
      font-size: 13px;
      line-height: 1.45;
      display: none;
    }
    .card.on { display: block; }
    .row { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
    .badge {
      font-size: 9px; letter-spacing: .09em; text-transform: uppercase;
      font-weight: 700; padding: 3px 7px; border-radius: 999px;
      background: linear-gradient(135deg,#8b5cf6,#22d3ee); color: #0b0a1a;
    }
    .badge.warn { background: linear-gradient(135deg,#fbbf24,#f43f5e); }
    .badge.done { background: linear-gradient(135deg,#a3e635,#22d3ee); }
    .goal {
      font-size: 10px; color: #807ca0; flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .step { font-weight: 600; font-size: 13.5px; }
    .obs { margin-top: 5px; font-size: 11.5px; color: #a8a4c7; }
    /* The one field that must never read as an explanation. */
    .why {
      margin-top: 9px; padding: 8px 10px;
      border-left: 2px solid #22d3ee;
      background: rgba(34,211,238,.07);
      border-radius: 0 8px 8px 0;
      font-size: 12px; color: #d0cde5;
    }
    .why b {
      display: block; font-size: 9px; letter-spacing: .08em;
      text-transform: uppercase; color: #22d3ee; margin-bottom: 3px;
      font-weight: 700;
    }
    .acts { display: flex; gap: 6px; margin-top: 10px; }
    .btn {
      font: inherit; font-size: 11px; cursor: pointer;
      padding: 5px 9px; border-radius: 7px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.05); color: #d0cde5;
    }
    .btn:hover { background: rgba(255,255,255,.12); color: #fff; }
    .spin {
      width: 11px; height: 11px; border-radius: 50%;
      border: 2px solid rgba(163,230,53,.25); border-top-color: #a3e635;
      animation: lens-spin .7s linear infinite;
    }
    @keyframes lens-spin { to { transform: rotate(360deg); } }
  `;

  function ensureGuideOverlay() {
    if (guideHost && guideHost.isConnected) return guideRoot;
    guideHost = document.createElement("div");
    guideHost.id = GUIDE_HOST_ID;
    guideHost.style.cssText = "all:initial;position:static;";
    // A capture may be in flight when an SPA nukes and re-creates us.
    // Rebuilding visible would put the ring back into the screenshot.
    if (!guideVisible) guideHost.style.display = "none";
    guideRoot = guideHost.attachShadow({ mode: "open" });
    guideRoot.innerHTML = `
      <style>${GUIDE_CSS}</style>
      <div class="layer">
        <div class="ring" id="ring"></div>
        <div class="dot" id="dot"></div>
        <div class="card" id="card">
          <div class="row">
            <span class="badge" id="badge">Step</span>
            <span class="goal" id="goal"></span>
          </div>
          <div class="step" id="step"></div>
          <div class="obs" id="obs"></div>
          <div class="why" id="why"><b>Before you click</b><span id="whyText"></span></div>
          <div class="acts">
            <button class="btn" id="relook">Not it — look again</button>
            <button class="btn" id="stop">Stop</button>
          </div>
        </div>
      </div>`;
    (document.documentElement || document.body).appendChild(guideHost);

    guideRoot.getElementById("relook").addEventListener("click", (e) => {
      e.stopPropagation();
      safeSendRuntime({ type: "GUIDE_RELOOK" });
      setGuideThinking();
    });
    guideRoot.getElementById("stop").addEventListener("click", (e) => {
      e.stopPropagation();
      safeSendRuntime({ type: "GUIDE_STOP" });
      clearGuide();
    });
    return guideRoot;
  }

  /** Keep the card on screen and off the control we are pointing at. */
  function placeGuideCard(card, nx, ny) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = card.offsetWidth || 340;
    const h = card.offsetHeight || 150;
    const px = nx * vw;
    const py = ny * vh;
    const GAP = 54;

    // Below the target when there's room, otherwise above it.
    let top = py + GAP;
    if (top + h > vh - 12) top = py - h - GAP;
    top = Math.max(12, Math.min(top, vh - h - 12));

    let left = px - w / 2;
    left = Math.max(12, Math.min(left, vw - w - 12));

    card.style.top = `${Math.round(top)}px`;
    card.style.left = `${Math.round(left)}px`;
  }

  function showGuideStep(step, goal) {
    const root = ensureGuideOverlay();
    const ring = root.getElementById("ring");
    const dot = root.getElementById("dot");
    const card = root.getElementById("card");
    const badge = root.getElementById("badge");
    const why = root.getElementById("why");

    if (step.target) {
      const left = `${step.target.nx * 100}vw`;
      const top = `${step.target.ny * 100}vh`;
      ring.style.left = left;
      ring.style.top = top;
      dot.style.left = left;
      dot.style.top = top;
      ring.classList.add("on");
      dot.classList.add("on");
    } else {
      ring.classList.remove("on");
      dot.classList.remove("on");
    }

    badge.className = "badge";
    if (step.status === "done") {
      badge.classList.add("done");
      badge.textContent = "Done";
    } else if (step.status === "blocked" || step.status === "off_track") {
      badge.classList.add("warn");
      badge.textContent = step.status === "blocked" ? "Stuck" : "Off track";
    } else {
      badge.textContent = `Step ${(step.index || 0) + 1}`;
    }

    root.getElementById("goal").textContent = goal || "";
    root.getElementById("step").textContent = step.step || "";
    root.getElementById("obs").textContent = step.observation || "";

    // `why` is a question or it is absent. It is never turned into prose
    // here — if the server stripped it, the section simply doesn't render.
    if (step.why) {
      root.getElementById("whyText").textContent = step.why;
      why.style.display = "";
    } else {
      why.style.display = "none";
    }

    card.classList.add("on");
    // Measure after paint, then place — offsetWidth is 0 before display.
    requestAnimationFrame(() =>
      placeGuideCard(card, step.target ? step.target.nx : 0.5, step.target ? step.target.ny : 0.25)
    );
  }

  function setGuideThinking() {
    const root = ensureGuideOverlay();
    root.getElementById("ring").classList.remove("on");
    root.getElementById("dot").classList.remove("on");
    const card = root.getElementById("card");
    card.classList.add("on");
    root.getElementById("badge").className = "badge";
    root.getElementById("badge").textContent = "Looking";
    root.getElementById("step").textContent = "Reading your screen…";
    root.getElementById("obs").textContent = "";
    root.getElementById("why").style.display = "none";
    requestAnimationFrame(() => placeGuideCard(card, 0.5, 0.12));
  }

  function showGuideError(message) {
    const root = ensureGuideOverlay();
    root.getElementById("ring").classList.remove("on");
    root.getElementById("dot").classList.remove("on");
    const card = root.getElementById("card");
    card.classList.add("on");
    const badge = root.getElementById("badge");
    badge.className = "badge warn";
    badge.textContent = "Error";
    root.getElementById("step").textContent = message;
    root.getElementById("obs").textContent = "";
    root.getElementById("why").style.display = "none";
    requestAnimationFrame(() => placeGuideCard(card, 0.5, 0.12));
  }

  function clearGuide() {
    if (guideHost && guideHost.isConnected) guideHost.remove();
    guideHost = null;
    guideRoot = null;
  }

  function setGuideOverlayVisible(visible) {
    guideVisible = visible;
    if (guideHost) guideHost.style.display = visible ? "" : "none";
  }

  // Any real interaction is a reason to look again. Capture phase, because
  // plenty of apps stopPropagation on their own controls. Clicks on our
  // own card don't count — those are ours, not progress.
  function onGuideInteraction(e) {
    if (!guideHost) return;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    if (path.includes(guideHost)) return;
    safeSendRuntime({ type: "GUIDE_ADVANCE", reason: e.type });
  }

  window.addEventListener("click", onGuideInteraction, true);
  // Typing then Enter is how half of a console flow is driven — a search
  // box, a name field, a command. Enter advances; other keys don't.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") onGuideInteraction(e);
    },
    true
  );

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

      // ── Guide ────────────────────────────────────────────────
      if (message.type === "GUIDE_SHOW") {
        showGuideStep(message.step, message.goal);
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "GUIDE_THINKING") {
        setGuideThinking();
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "GUIDE_ERROR") {
        showGuideError(message.error || "Guide step failed");
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "GUIDE_CLEAR") {
        clearGuide();
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "GUIDE_SET_OVERLAY_VISIBLE") {
        setGuideOverlayVisible(!!message.visible);
        // The background needs the CSS-pixel viewport to rescale the
        // model's coordinates back to this screen — it only has the
        // Retina-sized bitmap. Answering here saves a second round trip.
        sendResponse({ ok: true, width: window.innerWidth, height: window.innerHeight });
        return false;
      }
      if (message.type === "NOTIFY_SOURCE_CAPTURED") {
        // Only forward on the LENS app origin — Bootstrap.tsx is listening.
        if (LENS_ORIGINS.some((o) => window.location.origin === o)) {
          window.postMessage(
            {
              source: "lens-extension",
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
