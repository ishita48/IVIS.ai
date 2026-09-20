"use client";

/**
 * LiveActivityPanel — the class, as the event log actually describes it.
 *
 * Every number on this panel is a query. There are no constants left:
 *
 *   online          distinct students with any event in the last 15 min
 *   understanding   the tutor's own most recent read per student
 *                   (`understanding_noted`), bucketed
 *   questions       real student turns that ended in a question mark
 *   struggles       beliefs the tutor named, counted across the class
 *
 * The percentages are computed from counts rather than stored, so a class
 * where nobody has been read yet shows "no readings yet" instead of a
 * confident 0%. That distinction matters more than it looks: a teacher
 * seeing 0% understanding would reasonably panic, when the truth is that
 * the tutor has not formed a view of anyone.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Flag,
  HelpCircle,
  Loader2,
  MessageCircle,
  Quote,
  RefreshCw,
  UserCheck,
} from "lucide-react";

export type Activity = {
  online: number;
  roster: number;
  understanding: { solid: number; shaky: number; stuck: number };
  questions: { text: string; at: string }[];
  struggles: { belief: string; count: number }[];
  activeSessions: number;
  sampledFrom: number;
};

const BARS = [
  { key: "solid", label: "Understanding", icon: CheckCircle2, from: "from-emerald-400", to: "to-emerald-500", text: "text-emerald-600" },
  { key: "shaky", label: "Need help", icon: HelpCircle, from: "from-amber-400", to: "to-amber-500", text: "text-amber-600" },
  { key: "stuck", label: "Stuck", icon: Flag, from: "from-rose-400", to: "to-rose-500", text: "text-rose-600" },
] as const;

/** How often the panel re-reads. Fast enough to feel live, slow enough to be cheap. */
const POLL_MS = 20_000;

export function LiveActivityPanel({
  classId,
  topic,
}: {
  classId: string | null;
  topic: string;
}) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animated, setAnimated] = useState(false);

  const load = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/classes/${classId}/activity`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        activity?: Activity;
        error?: string;
      };
      if (!res.ok || !data.activity) throw new Error(data.error || "Could not read activity.");
      setActivity(data.activity);
      setError(null);
      setTimeout(() => setAnimated(true), 120);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read activity.");
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void load();
    if (!classId) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load, classId]);

  const u = activity?.understanding;
  const read = u ? u.solid + u.shaky + u.stuck : 0;
  const pct = (n: number) => (read ? Math.round((n / read) * 100) : 0);

  return (
    <div className="flex flex-col gap-6 rounded-3xl glass-panel p-6 sm:p-8 lg:col-span-2">
      <div className="flex flex-col gap-4 border-b border-white/50 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-3 text-[20px] font-bold text-ink-100">
            <span className="relative flex size-3.5">
              {(activity?.online ?? 0) > 0 && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex size-3.5 rounded-full border-2 border-white ${
                  (activity?.online ?? 0) > 0 ? "bg-rose-500" : "bg-ink-600"
                }`}
              />
            </span>
            Live Class Activity
          </h2>
          <h3 className="mt-1 text-[15px] font-medium text-ink-400">
            Topic: <span className="font-semibold text-ink-100">{topic || "not set"}</span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-[13px] font-semibold ${
              (activity?.online ?? 0) > 0
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600"
                : "border-ink-800/15 bg-white/40 text-ink-500"
            }`}
          >
            <UserCheck className="size-4" />
            {activity?.online ?? 0} of {activity?.roster ?? 0} online
          </div>
          <button
            onClick={() => void load()}
            disabled={loading || !classId}
            className="rounded-xl border border-ink-800/15 p-2 text-ink-500 transition hover:text-ink-200 disabled:opacity-40"
            aria-label="Refresh"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </button>
        </div>
      </div>

      {!classId ? (
        <p className="rounded-2xl bg-white/50 px-5 py-8 text-center text-[13px] text-ink-500">
          Create a class to see what your students are working on.
        </p>
      ) : error ? (
        <div className="rounded-2xl border border-rose-300/40 bg-rose-50/60 p-4 text-[13px] text-rose-700">
          {error}
        </div>
      ) : (
        <>
          {/* ── Understanding split ─────────────────────────────── */}
          {read === 0 ? (
            <p className="rounded-2xl bg-white/50 px-5 py-6 text-center text-[13px] leading-relaxed text-ink-500">
              No understanding readings yet. LENS records one when it forms a
              view of a student while they work — until then there is nothing
              honest to show here.
            </p>
          ) : (
            <div className="space-y-5">
              {BARS.map((b) => {
                const Icon = b.icon;
                const count = u ? u[b.key] : 0;
                const value = pct(count);
                return (
                  <div key={b.key}>
                    <div className="mb-2 flex items-end justify-between">
                      <span className="flex items-center gap-2 text-[13px] font-bold text-ink-200">
                        <Icon className={`size-4 ${b.text}`} />
                        {b.label}
                      </span>
                      <span className={`text-[16px] font-bold ${b.text}`}>
                        {value}%
                        <span className="ml-1.5 text-[12px] font-medium text-ink-500">
                          {count} of {read}
                        </span>
                      </span>
                    </div>
                    <div className="h-3.5 w-full rounded-full border border-white/60 bg-white/40 shadow-inner">
                      <div
                        className={`h-3.5 rounded-full bg-gradient-to-r ${b.from} ${b.to} transition-[width] duration-[900ms] ease-out`}
                        style={{ width: animated ? `${value}%` : "0%" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Real questions ──────────────────────────────────── */}
          <div className="rounded-2xl glass p-5 sm:p-6">
            <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-ink-100">
              <MessageCircle className="size-4 text-signal-deep" />
              What students are asking
            </h3>
            <p className="mb-3.5 text-[13px] text-ink-400">
              Pulled from what they actually said to the tutor
              {activity ? ` — ${activity.sampledFrom} events read` : ""}.
            </p>
            {activity?.questions.length ? (
              <ul className="space-y-2.5">
                {activity.questions.map((q, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-xl border border-white/70 bg-white/60 p-3.5 shadow-card transition hover:shadow-lift"
                  >
                    <div className="mt-0.5 shrink-0 rounded-lg bg-signal/12 p-1.5 text-signal-deep">
                      <Quote className="size-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium leading-relaxed text-ink-200">
                        {q.text}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-500">
                        {new Date(q.at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-500">
                Nobody has asked the tutor anything yet.
              </p>
            )}
          </div>

          {/* ── Shared misconceptions ───────────────────────────── */}
          {(activity?.struggles.length ?? 0) > 0 && (
            <div className="rounded-2xl glass p-5 sm:p-6">
              <h3 className="mb-3 text-[15px] font-bold text-ink-100">
                Beliefs coming up across the class
              </h3>
              <ul className="space-y-2">
                {activity!.struggles.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-3 rounded-xl bg-amber-500/[0.07] px-4 py-3"
                  >
                    <span className="text-[13px] text-ink-200">“{s.belief}”</span>
                    <span className="shrink-0 text-[11px] font-semibold text-amber-700">
                      {s.count}×
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
