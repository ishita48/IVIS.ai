"use client";

/**
 * GroupSessionBar — the strip that says you are not alone in here.
 * ─────────────────────────────────────────────────────────────────────
 *
 * A circle's room is a normal session, which is exactly why this is
 * needed: every surface looks identical to the private workspace, so
 * without a marker a student can type into a shared room believing it is
 * their own notebook. The cost of that mistake is other people reading
 * something private, so it is worth a permanent strip rather than a toast
 * that disappears.
 *
 * It renders only for a session the server tagged with a classId, so it
 * cannot appear on a private session by accident — the flag comes from
 * the session document, not from anything the client decided.
 *
 * Two ways out, because "leave" means both things and they are not
 * equally reversible:
 *
 *   Back to my workspace  switches to a private session. Nothing changes
 *                         about the circle; you can walk back in.
 *   Leave circle          gives up membership. The room disappears from
 *                         the sidebar and the link stops working, so it
 *                         asks first.
 */

import { useState } from "react";
import { ArrowLeft, LogOut, Users } from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";

export function GroupSessionBar() {
  const sessionId = useLens((s) => s.sessionId);
  const pastSessions = useLens((s) => s.pastSessions);
  const newSession = useLens((s) => s.newSession);
  const switchSession = useLens((s) => s.switchSession);
  const loadSessions = useLens((s) => s.loadSessions);
  const pushToast = useLens((s) => s.pushToast);

  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const current = pastSessions.find((s) => s._id === sessionId);
  if (!current?.classId) return null;

  const name = current.circleName ?? "your circle";

  async function backToMine() {
    const mine = pastSessions.find((s) => !s.classId);
    if (mine) await switchSession(mine._id);
    else await newSession();
  }

  async function leave() {
    if (leaving || !current?.classId) return;
    setLeaving(true);
    try {
      const res = await fetch(`/api/classes/${current.classId}/leave`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        left?: boolean;
        error?: string;
      };
      if (!res.ok || !data.left) throw new Error(data.error || "Couldn't leave.");
      pushToast({ kind: "success", text: `You left ${name}.` });
      await backToMine();
      await loadSessions();
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn't leave the circle.",
      });
    } finally {
      setLeaving(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-full border border-signal/25 bg-signal/[0.07] px-4 py-2">
      <Users className="size-3.5 shrink-0 text-signal-deep" />
      <span className="text-[12px] font-semibold text-signal-deep">{name}</span>
      <span className="min-w-0 truncate text-[11.5px] text-ink-500">
        group session — everyone in this circle sees what you add here
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          onClick={backToMine}
          title="Switch back to your own workspace. You stay in the circle."
          className="flex items-center gap-1.5 rounded-full border border-ink-800/15 bg-white/60 px-3 py-1.5 text-[11.5px] font-medium text-ink-300 transition hover:border-signal/40 hover:text-ink-100"
        >
          <ArrowLeft className="size-3" />
          My workspace
        </button>

        {confirming ? (
          <>
            <span className="text-[11px] text-ink-500">Leave for good?</span>
            <button
              onClick={leave}
              disabled={leaving}
              className="rounded-full bg-rose-500 px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
            >
              {leaving ? "Leaving…" : "Yes, leave"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-full px-2 py-1.5 text-[11.5px] text-ink-500 hover:text-ink-200"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            title="Give up membership of this circle"
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-1.5",
              "text-[11.5px] font-medium text-rose-600 transition hover:bg-rose-50"
            )}
          >
            <LogOut className="size-3" />
            Leave circle
          </button>
        )}
      </div>
    </div>
  );
}
