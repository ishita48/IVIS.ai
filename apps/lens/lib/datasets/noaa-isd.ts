/**
 * NOAA Integrated Surface Database — one station, one year, hourly.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Chicago O'Hare (USAF 725300, WBAN 94846), 2023, from the ISD-Lite
 * archive. Both questions are about the daily cycle, and both have
 * answers that most people get confidently wrong for the same underlying
 * reason: they expect the air to respond to the sun instantly.
 *
 * Hours in the committed slice are UTC. O'Hare is UTC−5 in July, and both
 * snippets convert before reporting, so the numbers a student sees are
 * local clock times.
 */

import { argExtreme, meanByLocalHour, pad } from "./csv";
import type { Dataset } from "./types";
import { rung } from "./types";

/** O'Hare runs UTC−5 in July; the committed slice is in UTC. */
const CDT_OFFSET = -5;

/** Shared preamble: read the CSV on stdin, keep the rows that parse. */
const READ_CSV = `import csv, sys
from collections import defaultdict
from statistics import mean

rows = list(csv.DictReader(sys.stdin))

def hour_local(ts):
    # Slice timestamps are UTC; O'Hare runs UTC-5 in July.
    return (int(ts[11:13]) - 5) % 24

def by_hour(column):
    buckets = defaultdict(list)
    for r in rows:
        value = r[column]
        if value:
            buckets[hour_local(r["timestamp"])].append(float(value))
    return {h: mean(v) for h, v in buckets.items()}
`;

export const NOAA_ISD: Dataset = {
  id: "noaa-isd",
  title: "NOAA hourly surface observations — Chicago O'Hare, 2023",
  sourceUrl: "https://registry.opendata.aws/noaa-isd/",
  fetchNote:
    "ISD-Lite station 725300-94846, year 2023, from " +
    "https://www.ncei.noaa.gov/pub/data/noaa/isd-lite/2023/725300-94846-2023.gz " +
    "(the same records the Voloridge fetch script pulls from s3://noaa-isd). " +
    "The fixed-width fields were widened to CSV and the -9999 missing " +
    "sentinels were blanked; temperature, dew point, pressure and wind " +
    "speed were divided by 10 to their real units. 8,757 hourly rows, 376 KB.",
  csvPath: "fixtures/datasets/noaa-isd.csv",
  insight:
    "The air is hottest around 16:00, not at noon, and the wind is strongest " +
    "in the late afternoon rather than at night — both because the ground " +
    "keeps feeding heat upward for hours after the sun has passed its peak. " +
    "Almost everyone predicts noon, and almost everyone thinks nights are windy.",
  questions: [
    {
      id: "hottest-hour",
      prompt:
        "In July at O'Hare, which hour of the day is the hottest on average?",
      predictionQuestion:
        "Before the query runs: name the hour you think is hottest, on a local 24-hour clock.",
      months: [7],
      compute: (rows) => {
        const temps = meanByLocalHour(rows, "temp_c", CDT_OFFSET);
        const peak = argExtreme(temps, "max");
        const low = argExtreme(temps, "min");
        return (
          `Hottest hour: ${pad(peak)}:00 local at ${temps[peak].toFixed(1)} C. ` +
          `Noon averages ${temps[12].toFixed(1)} C. ` +
          `Coolest hour: ${pad(low)}:00 at ${temps[low].toFixed(1)} C.`
        );
      },
      reproduceWith:
        READ_CSV +
        `
temps = by_hour("temp_c")
peak = max(temps, key=temps.get)
low = min(temps, key=temps.get)
print(
    f"Hottest hour: {peak:02d}:00 local at {temps[peak]:.1f} C. "
    f"Noon averages {temps[12]:.1f} C. "
    f"Coolest hour: {low:02d}:00 at {temps[low]:.1f} C."
)
`,
      misconceptions: [
        {
          id: "temp_tracks_sun_instantly",
          wrongPredictions: [
            "noon",
            "12",
            "12pm",
            "12:00",
            "midday",
            "1pm",
            "13:00",
            "when the sun is highest",
          ],
          belief:
            "The air is hottest when the sun is most directly overhead, so it has to be noon.",
          misconception:
            "Air temperature tracks the sun's position instantly, instead of lagging behind it.",
          fix:
            "Air keeps warming for as long as arriving sunlight outweighs escaping heat, so the peak lands near 16:00 — roughly four hours after the sun is highest.",
          ladder: [
            rung(
              0,
              "nothing",
              "Before you look at the table: at noon, is the ground still taking in more heat than it is giving off, or has it already tipped the other way?"
            ),
            rung(
              1,
              "location",
              "Read the hourly averages from 12:00 through 18:00 — does the number stop climbing at the moment the sun begins to descend?"
            ),
            rung(
              2,
              "cause",
              "Temperature answers to a running balance between what arrives and what leaves, not to how high the sun happens to be at that instant."
            ),
            rung(
              3,
              "strategy",
              "Group every July row by its hour of day, average the temperature in each group, and find where the curve turns over."
            ),
            rung(
              4,
              "fix",
              "Air keeps warming for as long as arriving sunlight outweighs escaping heat, so the peak lands near 16:00 — roughly four hours after the sun is highest."
            ),
          ],
        },
      ],
    },
    {
      id: "windiest-hour",
      prompt:
        "In July at O'Hare, is the wind strongest at night or in the afternoon?",
      predictionQuestion:
        "Before the query runs: name the hour you think the wind is strongest, and say whether you expect nights to be windier than afternoons.",
      months: [7],
      compute: (rows) => {
        const winds = meanByLocalHour(rows, "wind_speed_ms", CDT_OFFSET);
        const temps = meanByLocalHour(rows, "temp_c", CDT_OFFSET);
        const peak = argExtreme(winds, "max");
        const calm = argExtreme(winds, "min");
        return (
          `Windiest hour: ${pad(peak)}:00 local at ${winds[peak].toFixed(1)} m/s. ` +
          `Calmest hour: ${pad(calm)}:00 at ${winds[calm].toFixed(1)} m/s ` +
          `(${(winds[peak] / winds[calm]).toFixed(1)}x). ` +
          `Temperature peaks at ${pad(argExtreme(temps, "max"))}:00.`
        );
      },
      reproduceWith:
        READ_CSV +
        `
winds = by_hour("wind_speed_ms")
temps = by_hour("temp_c")
peak = max(winds, key=winds.get)
calm = min(winds, key=winds.get)
print(
    f"Windiest hour: {peak:02d}:00 local at {winds[peak]:.1f} m/s. "
    f"Calmest hour: {calm:02d}:00 at {winds[calm]:.1f} m/s "
    f"({winds[peak] / winds[calm]:.1f}x). "
    f"Temperature peaks at {max(temps, key=temps.get):02d}:00."
)
`,
      misconceptions: [
        {
          id: "wind_independent_of_heating",
          wrongPredictions: [
            "night",
            "at night",
            "midnight",
            "3am",
            "early morning",
            "before dawn",
            "nights are windier",
          ],
          belief:
            "Wind is weather blowing through. It has nothing to do with the daily heating cycle, and nights feel windier anyway.",
          misconception:
            "Surface wind speed is independent of the day's heating cycle.",
          fix:
            "Daytime heating stirs the lowest layer of the atmosphere and drags quicker air down to the surface, so wind peaks in the late afternoon and falls calmest in the hours before dawn.",
          ladder: [
            rung(
              0,
              "nothing",
              "Think of the stillest, glassiest air you have ever stood in — what time of day was it, and did it stay that still once the sun was up?"
            ),
            rung(
              1,
              "location",
              "Average the wind column by hour of day exactly as you did the temperature, then lay the two shapes side by side."
            ),
            rung(
              2,
              "cause",
              "Air at the ground is tied to the faster air above it only while something keeps the two stirred together, and what does the stirring is heat."
            ),
            rung(
              3,
              "strategy",
              "Read the calmest hour and the windiest hour off the July profile, and notice how far apart on the clock they sit."
            ),
            rung(
              4,
              "fix",
              "Daytime heating stirs the lowest layer of the atmosphere and drags quicker air down to the surface, so wind peaks in the late afternoon and falls calmest in the hours before dawn."
            ),
          ],
        },
      ],
    },
  ],
};
