"use client";

/**
 * AvailabilityHeatmap — a When2Meet-style overlay of the class's available
 * hours, so a teacher can see the best time to schedule a study session.
 *
 * Still frontend-only placeholder data (see CreateSessionForm's note) —
 * heat level is derived from count/totalStudents rather than picked per
 * cell, so swapping in a real availability feed later is a data change,
 * not a rewrite.
 */

import { Clock, Lightbulb, Radar } from "lucide-react";

type Slot = { day: string; date: string; time: string; count: number };

const TOTAL_STUDENTS = 32;

const SLOTS: Slot[] = [
  { day: "Mon", date: "9/21", time: "4:00 PM", count: 12 },
  { day: "Tue", date: "9/22", time: "4:00 PM", count: 18 },
  { day: "Wed", date: "9/23", time: "4:00 PM", count: 5 },
  { day: "Thu", date: "9/24", time: "4:00 PM", count: 19 },
  { day: "Mon", date: "9/21", time: "5:00 PM", count: 22 },
  { day: "Tue", date: "9/22", time: "5:00 PM", count: 14 },
  { day: "Wed", date: "9/23", time: "5:00 PM", count: 8 },
  { day: "Thu", date: "9/24", time: "5:00 PM", count: 28 },
  { day: "Mon", date: "9/21", time: "6:00 PM", count: 6 },
  { day: "Tue", date: "9/22", time: "6:00 PM", count: 4 },
  { day: "Wed", date: "9/23", time: "6:00 PM", count: 11 },
  { day: "Thu", date: "9/24", time: "6:00 PM", count: 15 },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu"];
const TIMES = ["4:00 PM", "5:00 PM", "6:00 PM"];

function heatClass(count: number, isBest: boolean) {
  if (isBest) return "heat-highlight";
  const ratio = count / TOTAL_STUDENTS;
  if (ratio >= 0.5) return "heat-high";
  if (ratio >= 0.3) return "heat-med";
  return "heat-low";
}

function to24h(time: string) {
  const [, h, m, ap] = time.match(/(\d+):(\d+) (AM|PM)/) ?? [];
  let hour = Number(h);
  if (ap === "PM" && hour !== 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${m}`;
}

function toIsoDate(md: string) {
  const [month, day] = md.split("/").map(Number);
  return `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function AvailabilityHeatmap({
  onPickSlot,
}: {
  onPickSlot: (date: string, time: string) => void;
}) {
  const best = SLOTS.reduce((a, b) => (b.count > a.count ? b : a), SLOTS[0]);
  const bestPct = Math.round((best.count / TOTAL_STUDENTS) * 100);

  return (
    <div className="rounded-3xl glass-panel p-6 sm:p-8 lg:col-span-3">
      <div className="mb-6 flex flex-col gap-4 border-b border-white/50 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-[20px] font-bold text-ink-100">
            <Radar className="size-4.5 text-signal-deep" />
            Student Availability Sync
          </h2>
          <p className="mt-1 text-[13px] font-medium text-ink-400">
            When2Meet-style overlay of your {TOTAL_STUDENTS} students' available hours.
          </p>
        </div>
        <button
          onClick={() => onPickSlot(toIsoDate(best.date), to24h(best.time))}
          className="flex items-center gap-3 rounded-xl border border-signal/25 bg-white/70 p-3 text-left shadow-card transition hover:border-signal/45"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-signal text-white shadow-inner">
            <Lightbulb className="size-4.5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
              Recommended action
            </p>
            <p className="text-[13px] font-bold text-signal-deep">
              Schedule for {best.day} {best.time} ({bestPct}%)
            </p>
          </div>
        </button>
      </div>

      <div className="overflow-x-auto pb-2">
        <table className="w-full min-w-[600px] border-separate" style={{ borderSpacing: 8 }}>
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-wider text-ink-500">
              <th className="w-24 p-2 font-bold">Time</th>
              {DAYS.map((d) => (
                <th key={d} className="p-2 text-center font-bold">
                  {d} ({SLOTS.find((s) => s.day === d)?.date})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIMES.map((time) => (
              <tr key={time}>
                <td className="whitespace-nowrap p-2 font-bold text-ink-200">
                  <Clock className="mr-2 inline size-3.5 text-ink-500" />
                  {time}
                </td>
                {DAYS.map((day) => {
                  const slot = SLOTS.find((s) => s.day === day && s.time === time)!;
                  const isBest = slot === best;
                  return (
                    <td key={day} className="p-0">
                      <button
                        onClick={() => onPickSlot(toIsoDate(slot.date), to24h(slot.time))}
                        className={`w-full rounded-lg px-2 py-3 text-center text-[13px] transition hover:scale-[1.03] ${heatClass(slot.count, isBest)}`}
                      >
                        {slot.count} available
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-end gap-4 text-[11px] font-bold uppercase tracking-wider text-ink-500">
        <Legend cls="heat-low" label="Low" />
        <Legend cls="heat-med" label="Medium" />
        <Legend cls="heat-high" label="High" />
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-3 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}
