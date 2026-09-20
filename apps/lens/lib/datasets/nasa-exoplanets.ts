/**
 * NASA Exoplanet Archive — confirmed planets, one row per planet.
 * ─────────────────────────────────────────────────────────────────────
 *
 * TAP query with default_flag=1 (the preferred parameter set). Both
 * questions land on the same detection-bias insight: the famous planets
 * are the easy ones to find, not the typical ones.
 *
 * Blank cells mean "not measured" and are skipped — never treated as 0.
 */

import type { DatasetRow } from "./csv";
import type { Dataset } from "./types";
import { rung } from "./types";

const MERCURY_AU = 0.387;
/** Jupiter's radius in Earth radii — converts a median Rj into Re. */
const RJ_TO_RE = 11.2;

const READ_CSV = `import csv, sys
from statistics import median

rows = list(csv.DictReader(sys.stdin))

def measured(column):
    return [float(r[column]) for r in rows if r[column].strip()]
`;

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function measured(rows: DatasetRow[], column: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const raw = row[column];
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

export const NASA_EXOPLANETS: Dataset = {
  id: "nasa-exoplanets",
  title: "NASA Exoplanet Archive — confirmed planets",
  sourceUrl: "https://exoplanetarchive.ipac.caltech.edu/",
  fetchNote:
    "TAP sync from https://exoplanetarchive.ipac.caltech.edu/TAP/sync with " +
    "default_flag=1 (one row per planet, preferred parameter set): " +
    "select pl_name, pl_rade, pl_radj, pl_bmasse, pl_orbsmax, pl_orbper, " +
    "discoverymethod, disc_year from ps where default_flag=1. " +
    "6,366 planets, committed as fixtures/datasets/nasa-exoplanets.csv.",
  csvPath: "fixtures/datasets/nasa-exoplanets.csv",
  insight:
    "Most known exoplanets are smaller than Jupiter — the median is about " +
    "2.5 Earth radii — and every hot Jupiter with a measured orbit sits " +
    "inside Mercury's. Transit and radial-velocity surveys find the big " +
    "close-in ones first, so the headlines are the selection effect.",
  questions: [
    {
      id: "bigger-than-jupiter",
      prompt:
        "Are most known exoplanets bigger or smaller than Jupiter?",
      predictionQuestion:
        "Before the query runs: do you expect most known exoplanets to be bigger than Jupiter, or smaller?",
      compute: (rows) => {
        const radii = measured(rows, "pl_radj");
        const smaller = radii.filter((r) => r < 1).length;
        const pct = (100 * smaller) / radii.length;
        const med = medianOf(radii);
        return (
          `${pct.toFixed(1)}% of exoplanets with a measured radius are smaller than Jupiter ` +
          `(${smaller} of ${radii.length}). ` +
          `Median ${med.toFixed(2)} Jupiter radii = ${(med * RJ_TO_RE).toFixed(1)} Earth radii.`
        );
      },
      reproduceWith:
        READ_CSV +
        `
radii = measured("pl_radj")
smaller = sum(1 for r in radii if r < 1)
pct = 100.0 * smaller / len(radii)
med = median(radii)
print(
    f"{pct:.1f}% of exoplanets with a measured radius are smaller than Jupiter "
    f"({smaller} of {len(radii)}). "
    f"Median {med:.2f} Jupiter radii = {med * 11.2:.1f} Earth radii."
)
`,
      misconceptions: [
        {
          id: "famous_are_common",
          wrongPredictions: [
            "bigger",
            "larger",
            "mostly giants",
            "hot jupiters",
          ],
          belief:
            "The planets that make the news are Jupiter-sized or larger, so that must be what most confirmed exoplanets look like.",
          misconception:
            "The famous planets are the common ones.",
          fix:
            "Transit and radial-velocity surveys see big close-in planets most easily, so giants dominate the headlines while the typical confirmed planet is about 2.5 Earth radii.",
          ladder: [
            rung(
              0,
              "nothing",
              "If a survey only catches the loudest signals, would the catalogue it publishes look like the underlying population, or like the population it is best at catching?"
            ),
            rung(
              1,
              "location",
              "Count how many rows have a measured radius below one Jupiter radius, and how many sit above — which side holds the majority?"
            ),
            rung(
              2,
              "cause",
              "A detection method that needs a deep transit or a strong wobble will fill a catalogue with the objects that produce those signals, not with a fair draw of every world."
            ),
            rung(
              3,
              "strategy",
              "Take every row with a non-blank pl_radj, split at 1.0, report the share below that cut, and read the median of the same column."
            ),
            rung(
              4,
              "fix",
              "Transit and radial-velocity surveys see big close-in planets most easily, so giants dominate the headlines while the typical confirmed planet is about 2.5 Earth radii."
            ),
          ],
        },
      ],
    },
    {
      id: "hot-jupiter-orbits",
      prompt: "Do hot Jupiters orbit closer in than Mercury?",
      predictionQuestion:
        "Before the query runs: do you expect hot Jupiters to orbit closer than Mercury, farther out, or about the same?",
      compute: (rows) => {
        const orbits: number[] = [];
        for (const row of rows) {
          if (!row.pl_radj || !row.pl_orbper) continue;
          const radj = Number(row.pl_radj);
          const period = Number(row.pl_orbper);
          if (!Number.isFinite(radj) || !Number.isFinite(period)) continue;
          if (radj < 0.8 || period >= 10) continue;
          if (!row.pl_orbsmax) continue;
          const au = Number(row.pl_orbsmax);
          if (!Number.isFinite(au)) continue;
          orbits.push(au);
        }
        const inside = orbits.filter((au) => au < MERCURY_AU).length;
        const med = medianOf(orbits);
        const closer = MERCURY_AU / med;
        return (
          `All ${inside} hot Jupiters with a measured orbit sit inside Mercury's ${MERCURY_AU} AU. ` +
          `Median ${med.toFixed(3)} AU, ${closer.toFixed(1)}x closer.`
        );
      },
      reproduceWith:
        READ_CSV +
        `
MERCURY_AU = 0.387
orbits = []
for r in rows:
    if not r["pl_radj"].strip() or not r["pl_orbper"].strip():
        continue
    radj = float(r["pl_radj"])
    period = float(r["pl_orbper"])
    if radj < 0.8 or period >= 10:
        continue
    if not r["pl_orbsmax"].strip():
        continue
    orbits.append(float(r["pl_orbsmax"]))
inside = sum(1 for au in orbits if au < MERCURY_AU)
med = median(orbits)
print(
    f"All {inside} hot Jupiters with a measured orbit sit inside Mercury's {MERCURY_AU} AU. "
    f"Median {med:.3f} AU, {MERCURY_AU / med:.1f}x closer."
)
`,
      misconceptions: [
        {
          id: "giants_stay_put",
          wrongPredictions: [
            "farther",
            "about the same",
            "giants form far out",
          ],
          belief:
            "Giant planets form far from their star and stay there, so a Jupiter-sized world cannot orbit closer than Mercury.",
          misconception:
            "Giant planets must stay where they formed.",
          fix:
            "Giants migrate inward, and the ones we detect are the migrated ones.",
          ladder: [
            rung(
              0,
              "nothing",
              "Could a planet that formed in the cold outer disk end up on a path that skims its star, or is its birth orbit a permanent address?"
            ),
            rung(
              1,
              "location",
              "Keep only rows with radius at least 0.8 Jupiter radii and period under 10 days, then read their semi-major axes against Mercury's 0.387 AU."
            ),
            rung(
              2,
              "cause",
              "A giant can lose orbital energy to the disk that raised it, so the place it is found is not proof of the place it assembled."
            ),
            rung(
              3,
              "strategy",
              "Filter to the hot-Jupiter cut, drop blank orbits, and ask whether any surviving semi-major axis reaches Mercury's distance."
            ),
            rung(
              4,
              "fix",
              "Giants migrate inward, and the ones we detect are the migrated ones."
            ),
          ],
        },
      ],
    },
  ],
};
