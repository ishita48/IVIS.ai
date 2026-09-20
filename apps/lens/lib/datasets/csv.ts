/**
 * The slices are machine-generated, comma-separated, quote-free numbers,
 * so a full CSV parser would be dead weight. If a future slice needs
 * quoting, replace this — do not teach it to half-handle quotes.
 *
 * Pure: no fs, no network. Client and server both import it.
 */

export type DatasetRow = Record<string, string>;

export function parseRows(csv: string): DatasetRow[] {
  // The slices are written by tools that emit CRLF. A stray \r on the last
  // column silently turned its header into a key nothing could look up,
  // so strip it here rather than trusting whoever generated the file.
  const lines = csv
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: DatasetRow = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? "";
    });
    return row;
  });
}

/** Mean of a column, bucketed by local hour of day. Blanks are skipped. */
export function meanByLocalHour(
  rows: DatasetRow[],
  column: string,
  utcOffsetHours: number
): Record<number, number> {
  const sums: Record<number, number> = {};
  const counts: Record<number, number> = {};
  for (const row of rows) {
    const value = row[column];
    if (!value) continue;
    const utcHour = Number(row.timestamp.slice(11, 13));
    if (!Number.isFinite(utcHour)) continue;
    const hour = (((utcHour + utcOffsetHours) % 24) + 24) % 24;
    sums[hour] = (sums[hour] ?? 0) + Number(value);
    counts[hour] = (counts[hour] ?? 0) + 1;
  }
  const means: Record<number, number> = {};
  for (const hour of Object.keys(sums)) {
    const h = Number(hour);
    means[h] = sums[h] / counts[h];
  }
  return means;
}

export function argExtreme(
  profile: Record<number, number>,
  which: "max" | "min"
): number {
  const hours = Object.keys(profile).map(Number);
  return hours.reduce((best, hour) =>
    which === "max"
      ? profile[hour] > profile[best]
        ? hour
        : best
      : profile[hour] < profile[best]
        ? hour
        : best
  );
}

export const pad = (hour: number): string => String(hour).padStart(2, "0");
