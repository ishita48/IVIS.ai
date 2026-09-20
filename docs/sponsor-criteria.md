# HackMIT 2026 sponsor challenges — what each one actually judges

Condensed from the official challenge list on 2026-09-20. Only sponsors LENS can plausibly
submit to are detailed; the rest are listed at the bottom so nobody wastes an hour on them.
`docs/sponsors.md` was written before this list existed and targets the wrong criteria for
Voloridge, Warp and MongoDB — this file wins where they disagree.

## Real shots

**OpenAI — "5th Teammate"** (top 3; ChatGPT Pro). Two axes, both required: (1) how creatively
the OpenAI API powers the experience; (2) how Codex meaningfully helped plan, implement,
test, debug or iterate. In the demo: show the product, explain the API use, and give **one
concrete way Codex improved the process or outcome**. Credits only for teams that submit.

**ElevenLabs** (judged virtually — Plume video + write-up decide it). Agentic depth (autonomous
agent with real-time dialogue and complex logic, not TTS), interaction design (latency,
inflection), technical integration (multimodal voice + video, agent personality prompt
engineering), novelty.

**Dropbox — "Turn digital chaos into something useful"** (1st: AirPods Max + interview).
Their own listed example: *"transform class materials into a personalized tutor."* That is
LENS's Dropbox path verbatim. Judged on turning fragmented content into something
organized, understandable or actionable.

**Elastic — "Find the Signal"** (Quest 3S / Bose). Best use of Elasticsearch to turn complex,
messy data into insights, answers or actions. The kNN mistake memory across sessions is the
signal story; hybrid notes search is the supporting one.

**The Token Company — LLM cost saving** ($500 + interview). Most creative cost saving
**inside the product**: cheaper models, caching, smaller inputs, denser outputs, or better.
Needs a before/after number. Their compression models are optional bonus.

**Cognition — Best Use of Devin** ($5K). Creativity, novelty, polish of what Devin built.

**Deepgram** (Switch per member). Qualifies only if the project **calls a Deepgram API**.
The module in `lib/deepgram.ts` is never called today, so LENS does not qualify yet.

**Long Lake — "Convince a Non-Believer"** (top 3). An AI experience a skeptic would try,
love and use again. Submission framing only; no build.

**Ramp — "Save Time. Save Money."** (Switch + Oura + $100/member). Anything that saves time
and money. Submission framing only.

## Misreads in the current repo, and the decision (2026-09-20 03:00)

Isha decided to submit to Voloridge, Warp and SpaceXAI anyway. The angles below are the
ones that make LENS eligible with the least new code. Prompts: V1 and W1 in
`docs/round4-prompts.md`.

- **Voloridge — "Signal in the Noise"** ($5K, 1st only). Build with **their curated public
  datasets**. Judged on originality, technical excellence, insight, execution. The 20-bug
  benchmark does not count. **Angle:** a "data objective" — the student reasons about a
  real dataset, predicts before the query runs, and LENS's ladder names the belief behind a
  wrong prediction. The dataset is the noise; the student's job is the signal.
  Their list (fetch scripts at `s3://voloridge-hack-mit-2026/src`, `aws s3 sync
  --no-sign-request`): NOAA ISD hourly weather, OpenAlex scholarly index, GDELT news
  events, NYC TLC taxi trips, OpenAQ air quality, PUDL US energy, Materials Project.
  Other datasets are allowed if you talk to their booth. They also lend AWS compute.
- **Warp — Best Developer Tool.** Improves the developer experience anywhere in the
  lifecycle; using Warp itself is optional. **Angle:** two things in the tree already are
  developer tools: the LENS Guide extension walking a developer through an unfamiliar
  console (Atlas, Vercel, Clerk) with goal-aware steps, and `lib/server-boundary.test.ts`,
  the check that caught Devin's Mongo-in-the-client bug. Package the second as a CLI any
  Next.js repo can run, and demo the first on a real console.
- **MongoDB.** No MongoDB challenge exists in the list. Blurb 13 is booth trivia only.

## SpaceXAI — "Make it Legendary" (top 4)

Hard requirements: built with **Cursor** (the more, the better), must use **Grok Imagine or
Grok Voice API**, real space data in. Bonus for Grok Bot planning. **Angle:** the same
"data objective" mechanism as Voloridge, built **in Cursor from the first commit**, with a
second objective over a NASA dataset (Exoplanet Archive transit data) and Grok Imagine
generating the reference image that `compare_to_reference` shows the student. Only the
commits made from Cursor count; keep that feature on its own branch so the trail is clean.

## Not applicable to LENS

ASUS (dropped, no hardware), Arduino UNO Q, Espressif, Hackster/Nordic, Dimensional (all
need electronics; the gear train is a passive print), Visa (commerce), Maximor (CFO agent),
GiveCampus (constituent data), Regeneron (clinical trials), Arrowstreet (greenwashing text),
Meta (needs Muse API or Graph API and a human-connection product; the teacher dashboard is
placeholder data), Runpod (TBA).
