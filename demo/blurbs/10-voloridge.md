# 10-voloridge

**Live.** LENS runs a data objective on Voloridge's curated NOAA ISD dataset.
`apps/lens/lib/datasets/noaa-isd.ts` holds one station-year — Chicago O'Hare
(725300-94846), 2023, 8,757 hourly rows from the ISD-Lite archive — behind two
questions. The student names an hour before any query runs
(`predictionQuestion`), the real computation runs against the committed CSV
slice, and the five-rung ladder for the matching misconception names the
belief behind a wrong prediction without stating the fix until rung 4. Both
questions expose the same misconception, that air answers the sun instantly:
noon averages 26.5 °C against 27.9 °C at 16:00, and afternoons run 2.0×
windier than the hours before dawn.

Every ladder in the registry is checked by
`apps/lens/lib/datasets/datasets.test.ts`: each opens on a question that
reveals nothing, climbs the five reveal levels in order, states the fix only
at rung 4, and is cross-checked by running the published `reproduceWith`
Python snippet for real and demanding it agree with the TypeScript result —
a judge can paste that script and get the same number LENS shows the
student.

**Lives in:** `apps/lens/lib/datasets/noaa-isd.ts`, `apps/lens/lib/datasets/index.ts`,
`apps/lens/lib/datasets/datasets.test.ts`, `apps/lens/fixtures/datasets/noaa-isd.csv`
