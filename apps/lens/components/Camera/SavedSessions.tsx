"use client";

/**
 * SavedSessions — everything LENS has worked through with this student.
 *
 * Nothing here is a stored summary. Each row is an aggregation over the
 * event log, and opening one replays that session's events into the same
 * SessionSummary component the live session ends with. A reopened session
 * and a just-finished one are the same screen because they are built from
 * the same rows.
 *
 * A session with no events does not appear. There is no empty placeholder
 * row, because a list of sessions that did not happen is worse than a short
 * list.
 */

import { useCallback, useEffect, useState } from "react";
import { SessionSummary } from "@/components/Camera/SessionSummary";
import type { LoadedLiveSession, SavedLiveSession } from "@/lib/lens/contracts";

const pct = (n: number) => `${Math.round(n * 100)}%`;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const minutes = (from: string, to: string) => {
  const span = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  return span < 1 ? "under a minute" : `${span} min`;
};

export function SavedSessions({
  activeSessionId,
  reloadKey = 0,
  onClose,
}: {
  /** Highlighted in the list so the student can tell which one is live. */
  activeSessionId?: string | null;
  /** Bump to refetch — e.g. after the current session is saved. */
  reloadKey?: number;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<SavedLiveSession[] | null>(null);
  const [open, setOpen] = useState<LoadedLiveSession | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/sessions/live", { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as {
        sessions?: SavedLiveSession[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || "Could not load your sessions.");
      setSessions(payload.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your sessions.");
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void list();
  }, [list, reloadKey]);

  const openSession = async (sessionId: string) => {
    setLoadingId(sessionId);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/live/${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => ({}))) as {
        session?: LoadedLiveSession;
        error?: string;
      };
      if (!res.ok || !payload.session) {
        throw new Error(payload.error || "Could not open that session.");
      }
      setOpen(payload.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that session.");
    } finally {
      setLoadingId(null);
    }
  };

  // ── One session, reopened ───────────────────────────────────────────
  if (open) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-3xl glass-panel px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-ink-100">{open.title}</p>
            <p className="mt-0.5 text-[11px] text-ink-500">
              {when(open.startedAt)} · {minutes(open.startedAt, open.endedAt)} ·{" "}
              {open.eventCount} recorded events
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="shrink-0 rounded-full glass-chip px-3 py-1.5 text-[12px] text-ink-400 transition hover:text-ink-100"
          >
            Back
          </button>
        </div>

        <SessionSummary
          // Anything in this list is a session that already ended.
          ended
          notes={open.understanding}
          misconceptions={open.beliefs}
          looks={open.looks}
          predictions={open.predictions}
          onDismiss={() => setOpen(null)}
        />

        {open.transcript.length > 0 && (
          <div className="rounded-3xl glass-panel p-4">
            <p className="mb-3 text-[11px] uppercase tracking-wide text-ink-500">
              Transcript
            </p>
            <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
              {open.transcript.map((entry, i) => (
                <div key={i} className="text-[13px] leading-relaxed">
                  <span className="mr-2 text-[10px] uppercase tracking-wide text-ink-500">
                    {entry.role === "user" ? "you" : "lens"}
                  </span>
                  <span
                    className={entry.role === "user" ? "text-ink-300" : "text-ink-100"}
                  >
                    {entry.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── The list ────────────────────────────────────────────────────────
  return (
    <div className="rounded-3xl glass-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[14px] font-medium text-ink-100">Your sessions</p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            Rebuilt from what was recorded, not from a saved copy.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full glass-chip px-3 py-1.5 text-[12px] text-ink-400 transition hover:text-ink-100"
        >
          Close
        </button>
      </div>

      {error && (
        <div className="alert-error mb-3 rounded-2xl px-4 py-2.5 text-[12px]">{error}</div>
      )}

      {sessions === null ? (
        <p className="px-1 py-6 text-center text-[13px] text-ink-500">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="rounded-2xl bg-ink-100/[0.03] px-4 py-6 text-center text-[13px] text-ink-500">
          No sessions yet. Start one, work through something, and it appears here.
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => {
            const live = session.sessionId === activeSessionId;
            return (
              <li key={session.sessionId}>
                <button
                  type="button"
                  onClick={() => void openSession(session.sessionId)}
                  disabled={loadingId === session.sessionId}
                  className={`w-full rounded-2xl px-3.5 py-3 text-left transition disabled:opacity-50 ${
                    live
                      ? "bg-signal/[0.08] ring-1 ring-signal/25"
                      : "glass-chip hover:bg-ink-100/[0.05]"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] font-medium text-ink-100">
                      {session.title}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-500">
                      {loadingId === session.sessionId
                        ? "opening…"
                        : live
                          ? "in progress"
                          : session.saved
                            ? "saved"
                            : "unsaved"}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
                    <span>{when(session.startedAt)}</span>
                    <span>{minutes(session.startedAt, session.endedAt)}</span>
                    {session.looks > 0 && <span>{session.looks} looks</span>}
                    {session.predictions > 0 && (
                      <span>{session.predictions} predictions</span>
                    )}
                    {session.misconceptions > 0 && (
                      <span>{session.misconceptions} beliefs named</span>
                    )}
                    {session.finalUnderstanding !== null && (
                      <span className="font-medium text-signal-deep">
                        ended at {pct(session.finalUnderstanding)}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
