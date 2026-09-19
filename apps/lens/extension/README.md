# StudiO Chrome Extension

One-click capture of your study tabs (YouTube, Brightspace, Canvas, PDFs, Wikipedia, arXiv, etc.) into StudiO — where they instantly become flashcards, quizzes, summaries, and concept maps.

## Install (development mode)

1. Run the StudiO app locally first: `npm run dev` in the `studio/` folder.
2. Open Chrome → `chrome://extensions`.
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked**.
5. Select the `extension/` folder (the one with `manifest.json`).
6. The StudiO icon appears in your toolbar. Pin it for easy access.

## Usage

### Option A — one-click capture from the popup

1. Open a few study tabs (YouTube lecture, Brightspace module, a PDF, etc.)
2. Sign in to StudiO at `http://localhost:3000/app`
3. Click the StudiO extension icon
4. Click **Capture all study tabs** — it scans every open tab, filters to study sites, extracts content, and posts each to StudiO
5. Go to the StudiO tab and your sources are there

### Option B — click "Analyze all" inside StudiO

With the extension installed and the user signed in, clicking **Analyze all** inside the StudiO app will:

1. postMessage to the extension asking for all study tabs
2. Ingest them via `/api/sources/capture`
3. Generate flashcards, quiz, summary, and concept map from the captured sources — all in parallel

If the extension isn't installed, Analyze all just generates from whatever sources are already added.

## Study domains it auto-detects

- YouTube (pulls transcripts server-side)
- Brightspace / D2L
- Canvas
- Blackboard
- Coursera, edX, Khan Academy
- Any `.pdf` URL
- Wikipedia
- arXiv
- Google Docs
- Notion
- GitHub README / docs / wiki

Everything else is skipped by default. You can still use **Capture this page only** to force-add any page.

## Settings

Click **Settings** in the popup footer to change the StudiO API URL — useful if you deploy StudiO to a domain other than `http://localhost:3000`.

## Auth

The extension uses your existing StudiO browser session (Clerk cookie). If the popup says "Sign in to StudiO first," just open StudiO in a tab and sign in — the extension picks it up automatically.

## Files

```
extension/
├── manifest.json       # Manifest v3 config
├── background.js       # Service worker — tab queries, API calls
├── content.js          # Per-page extractor + StudiO app bridge
├── popup.html          # StudiO-branded UI
├── popup.js            # Popup wiring
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```
