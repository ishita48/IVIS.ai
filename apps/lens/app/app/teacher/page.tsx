"use client";

/**
 * The teacher dashboard.
 * ─────────────────────────────────────────────────────────────────────
 * Frontend only, by design (see PersonaGate / lib/persona.ts) — there's no
 * teacher-facing API yet, so the class roster, live activity, and
 * availability heatmap below are placeholder data. Wiring this up to real
 * data is a follow-up: swap each component's hardcoded values for a fetch
 * and the layout doesn't need to change.
 */

import { useState } from "react";
import { Presentation, Radio, Users } from "lucide-react";
import { TeacherTopBar } from "@/components/teacher/TeacherTopBar";
import { LiveActivityPanel } from "@/components/teacher/LiveActivityPanel";
import { CreateSessionForm, type NewSession } from "@/components/teacher/CreateSessionForm";
import { AvailabilityHeatmap } from "@/components/teacher/AvailabilityHeatmap";
import { UpcomingSessions } from "@/components/teacher/UpcomingSessions";

const CLASS = { name: "CS 111 — Intro to Programming", students: 32, activeSessions: 4 };
const CURRENT_TOPIC = "Python Functions";

export default function TeacherDashboard() {
  const [prefill, setPrefill] = useState<{ date: string; time: string } | null>(null);
  const [sessions, setSessions] = useState<(NewSession & { id: string })[]>([]);

  function createSession(s: NewSession) {
    setSessions((prev) => [{ ...s, id: crypto.randomUUID() }, ...prev]);
  }

  return (
    <div className="flex min-h-screen flex-col app-canvas">
      <TeacherTopBar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6 lg:px-8">
        <header className="mb-7 pl-1">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-signal-deep">
            <Presentation className="size-3.5" />
            My Classes
          </div>
          <h1 className="mb-3 text-[32px] font-extrabold tracking-tight text-ink-100 sm:text-[40px]">
            {CLASS.name}
          </h1>
          <div className="flex flex-wrap items-center gap-3 font-medium text-ink-400">
            <span className="flex items-center gap-2 rounded-full border border-white/60 bg-white/40 px-3 py-1 text-[13px] shadow-card">
              <Users className="size-3.5 text-signal-deep" />
              {CLASS.students} students
            </span>
            <span className="flex items-center gap-2 rounded-full border border-white/60 bg-white/40 px-3 py-1 text-[13px] shadow-card">
              <Radio className="size-3.5 text-emerald-500" />
              {CLASS.activeSessions} active study sessions
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <LiveActivityPanel topic={CURRENT_TOPIC} online={18} />

          <CreateSessionForm
            defaultTopic={CURRENT_TOPIC}
            prefillDate={prefill?.date}
            prefillTime={prefill?.time}
            onCreate={createSession}
          />

          <AvailabilityHeatmap onPickSlot={(date, time) => setPrefill({ date, time })} />

          <UpcomingSessions sessions={sessions} onRemove={(id) => setSessions((prev) => prev.filter((s) => s.id !== id))} />
        </div>
      </main>
    </div>
  );
}
