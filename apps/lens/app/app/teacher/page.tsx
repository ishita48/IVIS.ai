"use client";

/**
 * The teacher dashboard.
 * ─────────────────────────────────────────────────────────────────────
 * Every number here is now a query. Classes and rosters are Elastic
 * documents (lib/classroom.ts); the live panel and the heatmap are
 * aggregations over the same `lens-events` index the student side writes
 * to. There are no placeholder students, no invented understanding split
 * and no sample questions.
 *
 * An account with no classes sees an empty state and creates one. A class
 * with no activity reports zero rather than something plausible — a
 * dashboard that invents a 72% is the fastest way to make every other
 * number on the screen suspect.
 */

import { useCallback, useEffect, useState } from "react";
import { Presentation, Radio, Users } from "lucide-react";
import { TeacherTopBar } from "@/components/teacher/TeacherTopBar";
import { LiveActivityPanel } from "@/components/teacher/LiveActivityPanel";
import { CreateSessionForm, type NewSession } from "@/components/teacher/CreateSessionForm";
import { ActivityHeatmap } from "@/components/teacher/ActivityHeatmap";
import { UpcomingSessions } from "@/components/teacher/UpcomingSessions";
import { ClassPicker, type TeacherClass } from "@/components/teacher/ClassPicker";

type StoredSession = NewSession & { id: string };

export default function TeacherDashboard() {
  const [prefill, setPrefill] = useState<{ date: string; time: string } | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [klass, setKlass] = useState<TeacherClass | null>(null);

  const loadSessions = useCallback(async (classId: string) => {
    try {
      const res = await fetch(`/api/classes/${classId}/sessions`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        sessions?: (NewSession & { _id: string })[];
      };
      setSessions((data.sessions ?? []).map(({ _id, ...s }) => ({ ...s, id: _id })));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    if (klass?._id) void loadSessions(klass._id);
    else setSessions([]);
  }, [klass?._id, loadSessions]);

  async function createSession(s: NewSession) {
    if (!klass?._id) return;
    const res = await fetch(`/api/classes/${klass._id}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    const data = (await res.json().catch(() => ({}))) as { session?: NewSession & { _id: string } };
    if (res.ok && data.session) {
      const { _id, ...rest } = data.session;
      setSessions((prev) => [{ ...rest, id: _id }, ...prev]);
    }
  }

  async function removeSession(id: string) {
    if (!klass?._id) return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/classes/${klass._id}/sessions?sessionId=${id}`, { method: "DELETE" });
  }

  return (
    <div className="flex min-h-screen flex-col wave-canvas">
      <TeacherTopBar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6 lg:px-8">
        <header className="mb-7 pl-1">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-signal-deep">
            <Presentation className="size-3.5" />
            My Classes
          </div>
          <h1 className="mb-3 text-[32px] font-extrabold tracking-tight text-ink-100 sm:text-[40px]">
            {klass?.name ?? "No class yet"}
          </h1>
          <div className="flex flex-wrap items-center gap-3 font-medium text-ink-400">
            <span className="flex items-center gap-2 rounded-full border border-white/60 bg-white/40 px-3 py-1 text-[13px] shadow-card">
              <Users className="size-3.5 text-signal-deep" />
              {klass?.students ?? 0} student{klass?.students === 1 ? "" : "s"}
            </span>
            {klass && (
              <span className="flex items-center gap-2 rounded-full border border-white/60 bg-white/40 px-3 py-1 text-[13px] shadow-card">
                <Radio className="size-3.5 text-emerald-500" />
                join code {klass.joinCode}
              </span>
            )}
          </div>
        </header>

        <div className="mb-6">
          <ClassPicker selected={klass} onSelect={setKlass} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <LiveActivityPanel classId={klass?._id ?? null} topic={klass?.topic ?? ""} />

          <CreateSessionForm
            defaultTopic={klass?.topic ?? ""}
            prefillDate={prefill?.date}
            prefillTime={prefill?.time}
            onCreate={createSession}
          />

          <ActivityHeatmap
            classId={klass?._id ?? null}
            onPickSlot={(date, time) => setPrefill({ date, time })}
          />

          <UpcomingSessions sessions={sessions} onRemove={(id) => void removeSession(id)} />
        </div>
      </main>
    </div>
  );
}
