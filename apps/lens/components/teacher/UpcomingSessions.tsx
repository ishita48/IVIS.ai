"use client";

import { CalendarClock, MapPin, Trash2, Users } from "lucide-react";
import type { NewSession } from "./CreateSessionForm";

const LOCATION_LABEL: Record<string, string> = {
  zoom: "Zoom",
  library: "Library",
  classroom: "Classroom",
  custom: "Custom link",
};

export function UpcomingSessions({
  sessions,
  onRemove,
}: {
  sessions: (NewSession & { id: string })[];
  onRemove: (id: string) => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <div className="rounded-3xl glass-panel p-6 sm:p-8 lg:col-span-3">
      <h2 className="mb-1 flex items-center gap-2 text-[18px] font-bold text-ink-100">
        <CalendarClock className="size-4.5 text-signal-deep" />
        Sessions you've scheduled
      </h2>
      <p className="mb-5 text-[13px] text-ink-400">
        Not sent to students yet — this is local until session creation has somewhere real to go.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="group flex flex-col gap-2 rounded-2xl border border-white/70 bg-white/55 p-4 shadow-card"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[14px] font-bold text-ink-100">{s.topic || "Untitled session"}</span>
              <button
                onClick={() => onRemove(s.id)}
                aria-label="Remove session"
                className="shrink-0 text-ink-500 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="text-[12.5px] text-ink-400">
              {s.date || "No date"} · {s.time || "No time"}
            </div>
            <div className="flex items-center gap-3 text-[11.5px] text-ink-500">
              <span className="flex items-center gap-1">
                <MapPin className="size-3" />
                {LOCATION_LABEL[s.location] ?? s.location}
              </span>
              <span className="flex items-center gap-1">
                <Users className="size-3" />
                up to {s.maxStudents}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
