const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const statusCount = document.getElementById("statusCount");
const captureAllBtn = document.getElementById("captureAllBtn");
const captureThisBtn = document.getElementById("captureThisBtn");
const openLENSBtn = document.getElementById("openLENSBtn");
const msgEl = document.getElementById("msg");
const tabsList = document.getElementById("tabsList");
const tabsPreviewCount = document.getElementById("tabsPreviewCount");
const settingsLink = document.getElementById("settingsLink");
const settingsPanel = document.getElementById("settingsPanel");
const apiBaseInput = document.getElementById("apiBaseInput");

function showMsg(text, type) {
  msgEl.textContent = text;
  msgEl.className = `msg show ${type}`;
  setTimeout(() => {
    msgEl.className = "msg";
  }, 4000);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Status ──────────────────────────────────────────────────────
async function checkStatus() {
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (resp) => {
    if (resp && resp.success && resp.data && resp.data.signedIn) {
      statusDot.className = "status-dot connected";
      statusText.textContent = "Signed in to LENS";
      statusCount.textContent = `${resp.data.sourcesCount} sources`;
      captureAllBtn.disabled = false;
      captureThisBtn.disabled = false;
    } else if (resp && resp.success && resp.data && !resp.data.signedIn) {
      statusDot.className = "status-dot error";
      statusText.textContent = "Sign in to LENS first";
      statusCount.textContent = "—";
      captureAllBtn.disabled = true;
      captureThisBtn.disabled = true;
    } else {
      statusDot.className = "status-dot error";
      statusText.textContent = "LENS not reachable";
      statusCount.textContent = "offline";
      captureAllBtn.disabled = true;
      captureThisBtn.disabled = true;
    }
  });
}

// ── Tabs preview ────────────────────────────────────────────────
function refreshTabsPreview() {
  chrome.runtime.sendMessage({ type: "QUERY_ALL_TABS" }, (resp) => {
    const tabs = (resp && resp.tabs) || [];
    tabsPreviewCount.textContent = tabs.length.toString();
    if (!tabs.length) {
      tabsList.innerHTML =
        '<div class="tab-empty">No study tabs open — try YouTube, Brightspace, Canvas, or a PDF</div>';
      return;
    }
    tabsList.innerHTML = tabs
      .slice(0, 5)
      .map(
        (t) => `
        <div class="tab-item">
          <span class="tab-kind ${escapeHtml(t.sourceType || "webpage")}"></span>
          <span class="tab-title">${escapeHtml(t.title || t.url)}</span>
        </div>`
      )
      .join("");
    if (tabs.length > 5) {
      tabsList.innerHTML += `<div class="tab-empty" style="padding:6px 0 0">+${
        tabs.length - 5
      } more</div>`;
    }
  });
}

// ── Buttons ─────────────────────────────────────────────────────

const captureAllOriginalHTML = captureAllBtn.innerHTML;
const captureThisOriginalHTML = captureThisBtn.innerHTML;

captureAllBtn.addEventListener("click", () => {
  captureAllBtn.disabled = true;
  captureAllBtn.innerHTML =
    '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg><span>Capturing…</span>';
  chrome.runtime.sendMessage({ type: "CAPTURE_ALL_TABS" }, (resp) => {
    captureAllBtn.disabled = false;
    captureAllBtn.innerHTML = captureAllOriginalHTML;
    if (resp && resp.success) {
      if (resp.captured > 0) {
        showMsg(
          `Captured ${resp.captured} of ${resp.total} study tab${
            resp.total === 1 ? "" : "s"
          }`,
          "success"
        );
      } else if (resp.total === 0) {
        showMsg("No study tabs detected — open YouTube, Brightspace, etc.", "info");
      } else {
        showMsg("Capture failed — are you signed in to LENS?", "error");
      }
      checkStatus();
      refreshTabsPreview();
    } else {
      showMsg((resp && resp.error) || "Capture failed", "error");
    }
  });
});

captureThisBtn.addEventListener("click", async () => {
  captureThisBtn.disabled = true;
  captureThisBtn.innerHTML =
    '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg><span>Capturing…</span>';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("No active tab");

    // Inject content.js on demand — needed for tabs that were already open
    // when the extension was installed or reloaded.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (injectErr) {
      throw new Error(
        "Can't capture this page (restricted URL \u2014 try a normal website)"
      );
    }

    const data = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTENT" }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });

    if (!data || !data.content) {
      throw new Error("Couldn't extract content from this page");
    }

    chrome.runtime.sendMessage({ type: "CAPTURE_PAGE", data }, (resp) => {
      captureThisBtn.disabled = false;
      captureThisBtn.innerHTML = captureThisOriginalHTML;
      if (resp && resp.success) {
        showMsg(`Added: ${data.title}`, "success");
        checkStatus();
      } else {
        showMsg((resp && resp.error) || "Capture failed", "error");
      }
    });
  } catch (e) {
    captureThisBtn.disabled = false;
    captureThisBtn.innerHTML = captureThisOriginalHTML;
    showMsg(e.message || "Capture failed", "error");
  }
});

openLENSBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_STUDIO" });
  window.close();
});

// ── Settings ────────────────────────────────────────────────────
settingsLink.addEventListener("click", async () => {
  settingsPanel.classList.toggle("show");
  const { apiBase } = await chrome.storage.local.get("apiBase");
  apiBaseInput.value = apiBase || "https://studystudio.us";
});

apiBaseInput.addEventListener("change", async () => {
  const val = apiBaseInput.value.trim().replace(/\/+$/, "");
  await chrome.storage.local.set({ apiBase: val });
  showMsg("Saved — refreshing status…", "info");
  setTimeout(checkStatus, 300);
});

// ── Guide ───────────────────────────────────────────────────────
// The popup is a remote control, not the UI. Everything the student
// actually reads is the overlay on the page they're working in — this
// just starts, stops, and mirrors the current step so the state is
// legible after the popup has been closed and reopened.

const goalInput = document.getElementById("goalInput");
const guideBtn = document.getElementById("guideBtn");
const guideHint = document.getElementById("guideHint");
const guideLive = document.getElementById("guideLive");
const guideLiveGoal = document.getElementById("guideLiveGoal");
const guideLiveStep = document.getElementById("guideLiveStep");
const guideLiveWhy = document.getElementById("guideLiveWhy");

let guideActive = false;

function renderGuide(state) {
  guideActive = !!(state && state.active);

  if (!guideActive) {
    guideBtn.textContent = "Start guiding";
    guideBtn.className = "btn btn-primary";
    guideLive.classList.remove("show");
    goalInput.disabled = false;
    // A finished goal is worth leaving on screen — it's the proof it worked.
    if (state && state.last && state.last.status === "done") {
      guideHint.textContent = `Done: ${state.last.step}`;
    } else if (state && state.error) {
      guideHint.textContent = state.error;
    } else {
      guideHint.textContent =
        "LENS watches the tab you're on, points at the next control, and asks you why it matters before you click it.";
    }
    return;
  }

  guideBtn.textContent = "Stop guiding";
  guideBtn.className = "btn btn-secondary";
  goalInput.disabled = true;
  guideLive.classList.add("show");
  guideLiveGoal.textContent = state.goal || "";

  if (state.thinking) {
    guideLiveStep.textContent = "Reading your screen…";
    guideLiveWhy.textContent = "";
  } else if (state.error) {
    guideLiveStep.textContent = state.error;
    guideLiveWhy.textContent = "";
  } else if (state.last) {
    guideLiveStep.textContent = state.last.step;
    guideLiveWhy.textContent = state.last.why || "";
  }

  guideHint.textContent =
    "Switch to the tab you're working in — the step is drawn on the page itself.";
}

function refreshGuide() {
  chrome.runtime.sendMessage({ type: "GUIDE_GET_STATE" }, (resp) => {
    if (resp && resp.success) renderGuide(resp.state);
  });
}

guideBtn.addEventListener("click", () => {
  if (guideActive) {
    chrome.runtime.sendMessage({ type: "GUIDE_STOP" }, () => refreshGuide());
    return;
  }

  const goal = goalInput.value.trim();
  if (!goal) {
    showMsg("Tell LENS what you're trying to do first", "error");
    goalInput.focus();
    return;
  }

  guideBtn.disabled = true;
  guideBtn.textContent = "Looking…";
  chrome.runtime.sendMessage({ type: "GUIDE_START", goal }, (resp) => {
    guideBtn.disabled = false;
    if (!resp || !resp.success) {
      showMsg((resp && resp.error) || "Couldn't start the guide", "error");
    }
    refreshGuide();
    // The overlay is on the page, not in here — get out of the way.
    if (resp && resp.success) setTimeout(() => window.close(), 400);
  });
});

goalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) guideBtn.click();
});

// The background writes every step into chrome.storage, so mirroring it
// needs no message plumbing — and it keeps working if the popup happens
// to be open across a step.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.guide) renderGuide(changes.guide.newValue);
});

// ── Init ────────────────────────────────────────────────────────
checkStatus();
refreshTabsPreview();
refreshGuide();
