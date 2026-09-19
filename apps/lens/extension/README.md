# LENS Chrome Extension

Two things in one extension:

1. **Guide me through it** — tell LENS what you're trying to accomplish and it
   points at the next control on the real page, one step at a time.
2. **Capture study tabs** — one-click ingest of YouTube, Brightspace, Canvas,
   PDFs, Wikipedia, arXiv, etc. into LENS as sources.

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

## Guide mode

> **Running LENS locally?** Open the popup, click **Settings**, and set the
> API URL to `http://localhost:3000`. It defaults to the deployed app, and
> Guide will fail auth against it if you're only signed in locally.

Set a goal in the popup — "launch a t3.micro EC2 instance in us-east-1",
"add a GitHub Actions secret", "configure a Stripe webhook" — and hit
**Start guiding**. Then switch to the tab you're working in.

Each turn, LENS screenshots the visible tab, sends it to `/api/guide/step`,
and draws two things on the real page:

- a pulsing ring over the exact control to click
- a card with the step, and a **question** about why that step matters

It looks again whenever you click or press Enter, and after any navigation
finishes. When the goal is visibly accomplished it stops on its own.

### Why the step is an instruction but the "why" is a question

This is the one place LENS hands something over, and the split is
deliberate — see the `GuideStep` doc comment in `lib/lens/contracts.ts`.

Nobody learns anything by hunting for where a cloud console hid a button, so
withholding *that* is friction with no pedagogy behind it. The part that is
actually worth understanding — why this subnet, why this permission — stays a
question on the hint ladder. The server strips any `why` that comes back as a
statement rather than a question (`sanitizeWhy` in `lib/guide.ts`), so a
model having an off day degrades to no question rather than to an answer.

### Things that will bite you if you change this code

- **The overlay is hidden before every capture.** `captureVisibleTab`
  photographs the composited page, ring included. Leave it up and the model
  starts pointing at its own last bubble.
- **One step in flight at a time.** Otherwise a click storm fires a Computer
  Use call per click and the answers land out of order.
- **The screenshot is downscaled to the resolution we declare to the tool.**
  `captureVisibleTab` returns a Retina-sized image; skip the resize and every
  coordinate comes back at half scale. Same rule as `hooks/usePointer.ts`.
- **`GUIDE_RESOLUTIONS` in `background.js` mirrors `SUPPORTED_RESOLUTIONS` in
  `lib/pointer.ts`** and is kept in sync by hand — a service worker can't
  import from the Next app.

### Where it can't run

Chrome refuses to screenshot `chrome://` pages, the Web Store, and other
extensions' pages. Guide surfaces that as an error on the card rather than
guessing at coordinates.

### Cost

One Computer Use call per step, on every click and navigation. A ten-step
walkthrough with a few mis-clicks is realistically 15–20 calls.

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
├── background.js       # Service worker — tab queries, API calls, Guide loop
├── content.js          # Per-page extractor, app bridge, Guide overlay
├── popup.html          # StudiO-branded UI
├── popup.js            # Popup wiring
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```
