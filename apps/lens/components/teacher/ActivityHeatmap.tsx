"use client";

/**
 * ActivityHeatmap — when this class is actually studying.
 *
 * This replaces a When2Meet-style "student availability" grid that was
 * entirely invented. LENS has never asked anyone when they are free, so it
 * cannot honestly display that. It does know when students have been
 * working, because every surface writes a timestamped event — and for
 * picking a review slot that is the better question anyway: "when is this
 * class already studying" beats "when did they once say they were free".
 *
 * Each cell counts DISTINCT students active in that hour, not events, so
 * one busy student cannot outvote ten quiet ones. Clicking a cell prefills
 * the session form with the next occurrence of that day and hour.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";

type Cell = { day: number; hour: number; students: number };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The window a review block would realistically land in. */
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

function label(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

/** The next date on which this weekday falls, as yyyy-mm-dd. */
function nextDateFor(day: number): string {
  const now = new Date();
  const delta = (day - now.getDay() + 7) % 7;
  const d = new Date(now);
  d.setDate(now.getDate() + (delta === 0 ? 7 : delta));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ActivityHeatmap({
  classId,
  onPickSlot,
}: {
  classId: string | null;
  onPickSlot: (date: string, time: string) => void;
}) {
  const [cells, setCells] = useState<Cell[] | null>(null);
  const [best, setBest] = useState<Cell | null>(null);
  const [sampled, setSampled] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!classId) {
      setCells([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/classes/${classId}/heatmap`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        cells?: Cell[];
        best?: Cell | null;
        sampled?: number;
      };
      setCells(data.cells ?? []);
      setBest(data.best ?? null);
      setSampled(data.sampled ?? 0);
    } catch {
      setCells([]);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  const at = (day: number, hour: number) =>
    cells?.find((c) => c.day === day && c.hour === hour)?.students ?? 0;

  const peak = cells?.reduce((m, c) => Math.max(m, c.students), 0) ?? 0;

  return (
    <div className="flex flex-col gap-4 rounded-3xl glass-panel p-6 lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-100">
            <CalendarClock className="size-4 text-signal-deep" />
            When your class actually studies
          </h2>
          <p className="mt-1 text-[12px] text-ink-500">
            Distinct students active per hour, from the last three weeks of
            real sessions{sampled ? ` — ${sampled} events` : ""}.
          </p>
        </div>
        {loading && <Loader2 className="size-4 animate-spin text-ink-500" />}
      </div>

      {!classId ? (
        <p className="rounded-2xl bg-white/50 px-5 py-8 text-center text-[13px] text-ink-500">
          Pick a class to see when it&apos;s active.
        </p>
      ) : cells && cells.length === 0 ? (
        <p className="rounded-2xl bg-white/50 px-5 py-8 text-center text-[13px] leading-relaxed text-ink-500">
          No study activity recorded yet. Once your students use LENS, the
          hours they actually work show up here — nothing is assumed.
        </p>
      ) : (
        <>
          {best && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-signal/[0.08] px-4 py-3 text-[13px]">
              <span className="font-semibold text-signal-deep">Busiest slot</span>
              <span className="text-ink-200">
                {DAYS[best.day]} at {label(best.hour)} — {best.students} student
                {best.students === 1 ? "" : "s"} active
              </span>
              <button
                onClick={() =>
                  onPickSlot(nextDateFor(best.day), `${String(best.hour).padStart(2, "0")}:00`)
                }
                className="ml-auto rounded-lg bg-signal px-3 py-1 text-[11px] font-semibold text-ink-950"
              >
                Schedule then
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-[11px]">
              <thead>
                <tr>
                  <th className="w-14" />
                  {DAYS.map((d) => (
                    <th key={d} className="pb-1 font-semibold text-ink-500">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HOURS.map((hour) => (
                  <tr key={hour}>
                    <td className="pr-1 text-right font-mono text-ink-500">{label(hour)}</td>
                    {DAYS.map((_, day) => {
                      const n = at(day, hour);
                      const strength = peak ? n / peak : 0;
                      return (
                        <td key={day}>
                          <button
                            onClick={() =>
                              onPickSlot(
                                nextDateFor(day),
                                `${String(hour).padStart(2, "0")}:00`
                              )
                            }
                            title={`${DAYS[day]} ${label(hour)} — ${n} student${n === 1 ? "" : "s"}`}
                            className="h-6 w-full rounded-md border border-white/60 transition hover:ring-2 hover:ring-signal/40"
                            style={{
                              background:
                                n === 0
                                  ? "rgba(255,255,255,0.4)"
                                  : `rgba(0, 194, 168, ${0.15 + strength * 0.75})`,
                            }}
                          >
                            <span className="sr-only">{n} students</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-ink-500">
            <span>none</span>
            {[0.15, 0.4, 0.65, 0.9].map((a) => (
              <span
                key={a}
                className="size-3 rounded-sm border border-white/60"
                style={{ background: `rgba(0, 194, 168, ${a})` }}
              />
            ))}
            <span>{peak} student{peak === 1 ? "" : "s"}</span>
          </div>
        </>
      )}
    </div>
  );
}
