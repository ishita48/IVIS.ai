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

## Misreads in the current repo

- **Voloridge — "Signal in the Noise"** ($5K, 1st only). Build with **their curated public
  datasets** (earth observation, health, transport, climate, genomics, economics). The
  20-bug benchmark in `scripts/bench.ts` has nothing to do with this. Do not submit unless
  a Voloridge dataset is actually used. Blurb 10 and the `docs/sponsors.md` row are wrong.
- **Warp — Best Developer Tool.** Improves the developer experience; Warp usage itself is
  optional. LENS is not a developer tool. `infra/warp/lens.yaml` earns nothing.
- **MongoDB.** No MongoDB challenge exists in the list. Blurb 13 is booth trivia only.

## SpaceXAI — "Make it Legendary" (top 4)

Hard requirements: built with **Cursor** (the more, the better), must use **Grok Imagine or
Grok Voice API**, real space data in. Bonus for Grok Bot planning. LENS has none of the
three. Eligibility needs a Cursor build trail, which the existing 24 hours of commits do not
provide. Only worth it as a separate mini-project, not as a LENS submission.

## Not applicable to LENS

ASUS (dropped, no hardware), Arduino UNO Q, Espressif, Hackster/Nordic, Dimensional (all
need electronics; the gear train is a passive print), Visa (commerce), Maximor (CFO agent),
GiveCampus (constituent data), Regeneron (clinical trials), Arrowstreet (greenwashing text),
Meta (needs Muse API or Graph API and a human-connection product; the teacher dashboard is
placeholder data), Runpod (TBA).
