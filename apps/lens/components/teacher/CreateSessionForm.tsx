"use client";

/**
 * CreateSessionForm — lets a teacher spin up a study session for students
 * who are showing low understanding. Purely presentational: the form
 * collects fields and hands them to `onCreate`, which persists via
 * POST /api/classes/[id]/sessions (see TeacherDashboard).
 */

import { useEffect, useState } from "react";
import { CalendarPlus, Link2, MapPin, Paperclip, PlusCircle, Video } from "lucide-react";

export type NewSession = {
  topic: string;
  date: string;
  time: string;
  maxStudents: number;
  location: string;
  resource: string;
  prompt: string;
  challenge: string;
};

const LOCATIONS = [
  { value: "zoom", label: "Zoom", icon: Video },
  { value: "library", label: "Library", icon: MapPin },
  { value: "classroom", label: "Classroom", icon: MapPin },
  { value: "custom", label: "Custom link", icon: Link2 },
];

const CHALLENGES = ["Select from library...", "Basic Def Syntax", "Recursive Fibonacci"];

export function CreateSessionForm({
  defaultTopic,
  prefillDate,
  prefillTime,
  onCreate,
}: {
  defaultTopic: string;
  prefillDate?: string;
  prefillTime?: string;
  onCreate: (session: NewSession) => void;
}) {
  const [topic, setTopic] = useState(defaultTopic);
  const [date, setDate] = useState(prefillDate ?? "");
  const [time, setTime] = useState(prefillTime ?? "");
  const [maxStudents, setMaxStudents] = useState(20);
  const [location, setLocation] = useState(LOCATIONS[0].value);
  const [resource, setResource] = useState("");
  const [prompt, setPrompt] = useState("");
  const [challenge, setChallenge] = useState(CHALLENGES[0]);

  // Clicking a heatmap slot re-sends prefillDate/prefillTime as new props —
  // sync them into the form without touching fields the teacher already typed.
  useEffect(() => {
    if (prefillDate) setDate(prefillDate);
    if (prefillTime) setTime(prefillTime);
  }, [prefillDate, prefillTime]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    onCreate({ topic, date, time, maxStudents, location, resource, prompt, challenge });
  }

  return (
    <div className="flex h-full flex-col rounded-3xl glass-panel p-6 sm:p-8 lg:col-span-1">
      <div className="mb-6">
        <h2 className="mb-1.5 flex items-center gap-2 text-[20px] font-bold text-ink-100">
          <CalendarPlus className="size-4.5 text-signal-deep" />
          Create Session
        </h2>
        <p className="text-[13px] text-ink-400">Schedule a live review or group block.</p>
      </div>

      <form onSubmit={submit} className="flex flex-grow flex-col gap-4">
        <Field label="Topic">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Loops & Arrays"
            className="glass-input w-full rounded-xl p-3 text-[13px] font-medium"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="glass-input w-full rounded-xl p-3 text-[13px] font-medium text-ink-400"
            />
          </Field>
          <Field label="Time">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="glass-input w-full rounded-xl p-3 text-[13px] font-medium text-ink-400"
            />
          </Field>
        </div>

        <Field label="Where">
          <div className="grid grid-cols-2 gap-2">
            {LOCATIONS.map((loc) => {
              const Icon = loc.icon;
              const active = location === loc.value;
              return (
                <button
                  key={loc.value}
                  type="button"
                  onClick={() => setLocation(loc.value)}
                  className={
                    "flex items-center gap-1.5 rounded-xl border p-2.5 text-[12.5px] font-semibold transition " +
                    (active
                      ? "border-signal/50 bg-signal/12 text-signal-deep"
                      : "border-white/70 bg-white/40 text-ink-400 hover:bg-white/60")
                  }
                >
                  <Icon className="size-3.5" />
                  {loc.label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Max students">
            <input
              type="number"
              min={1}
              value={maxStudents}
              onChange={(e) => setMaxStudents(Number(e.target.value) || 1)}
              className="glass-input w-full rounded-xl p-3 text-[13px] font-medium"
            />
          </Field>
          <Field label="Resources">
            <div className="relative">
              <input
                value={resource}
                onChange={(e) => setResource(e.target.value)}
                placeholder="Link or file"
                className="glass-input w-full rounded-xl p-3 pr-9 text-[13px] font-medium"
              />
              <Paperclip className="pointer-events-none absolute right-3 top-3.5 size-3.5 text-ink-500" />
            </div>
          </Field>
        </div>

        <Field label="Discussion prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Add a prompt to kick off the session..."
            className="glass-input h-20 w-full resize-none rounded-xl p-3 text-[13px] font-medium"
          />
        </Field>

        <Field label="Coding challenge (optional)">
          <select
            value={challenge}
            onChange={(e) => setChallenge(e.target.value)}
            className="glass-input w-full appearance-none rounded-xl p-3 text-[13px] font-medium"
          >
            {CHALLENGES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>

        <div className="mt-auto pt-2">
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-signal px-4 py-3.5 font-bold text-white shadow-glow transition duration-300 hover:-translate-y-0.5 hover:bg-signal-deep"
          >
            <PlusCircle className="size-4" />
            Create Session
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block pl-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-500">
        {label}
      </label>
      {children}
    </div>
  );
}
