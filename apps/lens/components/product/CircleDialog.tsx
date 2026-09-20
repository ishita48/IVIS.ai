"use client";

/**
 * Circles — study groups a student makes for their friends.
 * ─────────────────────────────────────────────────────────────────────
 *
 * This is the teacher's classroom backend seen from the other side. A
 * circle IS a class whose owner happens to be a student: same documents in
 * lens-classes and lens-memberships, same join codes, same Resend invite
 * route, same /join/[code] landing. Nothing new was added underneath, which
 * is why this could be built in an hour and why a circle already benefits
 * from every fix the classroom path gets.
 *
 * THE EMAIL IS THE OPTIONAL PART, and the UI has to say so rather than
 * imply the opposite. `POST /api/classes/[id]/invite` writes the roster
 * first and then attempts mail, so an invite is real even when nothing is
 * delivered. Two things routinely stop delivery and neither is a bug:
 *
 *   - With no RESEND_API_KEY there is no mail at all.
 *   - Resend's shared onboarding@resend.dev sender only delivers to the
 *     address that owns the Resend account. Every other recipient comes
 *     back 403 until a domain is verified.
 *
 * So the join link is shown as the primary way in, always, with a copy
 * button — and per-recipient failures are printed verbatim underneath
 * instead of being flattened into "invites sent". A student standing at a
 * table can read a code to a friend and it works; that is the path that
 * has to be reliable.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Loader2,
  Mail,
  Plus,
  Users,
  X,
} from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";

type Circle = {
  _id: string;
  name: string;
  topic?: string | null;
  joinCode: string;
  students: number;
  isOwner: boolean;
};

type InviteResult = { email: string; sent: boolean; error?: string };

export function CircleDialog({ onClose }: { onClose: () => void }) {
  const pushToast = useLens((s) => s.pushToast);

  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [active, setActive] = useState<Circle | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [inviting, setInviting] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  /**
   * Open the circle's shared workspace in a new tab.
   *
   * A new tab rather than a navigation, because the person doing this is
   * usually mid-session in their own work: a circle is somewhere you go
   * *as well as* your private workspace, not instead of it.
   *
   * The room is resolved server-side first so the tab never opens onto an
   * error. The window is opened before the await in Safari's eyes would
   * count as a user gesture — so it is opened immediately and navigated
   * once the id comes back, which is the one reliable way to survive a
   * popup blocker.
   */
  async function launch(c: Circle) {
    if (launching) return;
    setLaunching(true);
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`/api/classes/${c._id}/session`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!res.ok || !data.sessionId) throw new Error(data.error || "Could not open it.");
      const url = `/app?session=${encodeURIComponent(data.sessionId)}`;
      if (tab) tab.location.href = url;
      else window.location.href = url; // popup blocked: go here instead
    } catch (err) {
      tab?.close();
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not open the group session.",
      });
    } finally {
      setLaunching(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/classes", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        classes?: Circle[];
        error?: string;
      };
      if (!res.ok) {
        // 503 means Elastic isn't configured. Say which knob, not "failed".
        setUnavailable(data.error || "Circles are unavailable right now.");
        setCircles([]);
        return;
      }
      setCircles(data.classes ?? []);
      setActive((prev) => prev ?? data.classes?.[0] ?? null);
    } catch {
      setUnavailable("Couldn't reach the server.");
      setCircles([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes, which people expect from anything that dims the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const joinUrl = active
    ? `${typeof window === "undefined" ? "" : window.location.origin}/join/${active.joinCode}`
    : "";

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        class?: Circle;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Couldn't create that circle.");
      setName("");
      await load();
      if (data.class) {
        const created = { ...data.class, students: 0, isOwner: true };
        setActive(created);
        // Straight into the room. Making one and then being handed a code
        // to look at is the step that made circles feel like a mailing
        // list rather than a place.
        void launch(created);
      }
      pushToast({ kind: "success", text: `Circle "${trimmed}" created.` });
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn't create that circle.",
      });
    } finally {
      setCreating(false);
    }
  }

  async function invite() {
    if (!active || inviting || !emails.trim()) return;
    setInviting(true);
    setResults(null);
    try {
      const res = await fetch(`/api/classes/${active._id}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        added?: number;
        sent?: number;
        results?: InviteResult[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Couldn't invite them.");
      setResults(data.results ?? []);
      setEmails("");
      await load();
      pushToast({
        kind: "success",
        text: `${data.added} added to the circle · ${data.sent ?? 0} emailed`,
      });
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn't invite them.",
      });
    } finally {
      setInviting(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      pushToast({ kind: "error", text: "Couldn't copy — select the link instead." });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/95 shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-ink-800/10 px-5 py-4">
          <Users className="size-4 text-signal-deep" />
          <h2 className="text-[15px] font-bold text-ink-100">Your circles</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-full p-1.5 text-ink-500 transition hover:bg-ink-50 hover:text-ink-200"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {unavailable ? (
            <p className="rounded-2xl bg-amber-50 px-4 py-6 text-center text-[13px] leading-relaxed text-amber-900">
              {unavailable}
            </p>
          ) : circles === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink-500">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              {/* ── Pick a circle ──────────────────────────────────── */}
              {circles.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {circles.map((c) => (
                    <button
                      key={c._id}
                      onClick={() => {
                        setActive(c);
                        setResults(null);
                      }}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[12px] font-medium transition",
                        active?._id === c._id
                          ? "bg-signal text-white shadow-card"
                          : "bg-ink-50 text-ink-300 hover:bg-ink-100"
                      )}
                    >
                      {c.name}
                      <span className="ml-1.5 opacity-70">{c.students}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* ── Make one ───────────────────────────────────────── */}
              <div className="mb-5 flex gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                  placeholder={
                    circles.length ? "New circle name" : "Name your first circle"
                  }
                  className="flex-1 rounded-xl border border-ink-800/15 bg-white px-3 py-2 text-[13px] outline-none focus:border-signal/50"
                />
                <button
                  onClick={create}
                  disabled={creating || !name.trim()}
                  className="flex items-center gap-1.5 rounded-xl bg-signal px-3.5 py-2 text-[12px] font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
                >
                  {creating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Create
                </button>
              </div>

              {active && (
                <>
                  {/* ── The link, which always works ───────────────── */}
                  <div className="mb-4 rounded-2xl bg-signal/[0.07] p-4">
                    <p className="mb-2 text-[12px] font-semibold text-ink-200">
                      Anyone with this link can join {active.name}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-lg bg-white/80 px-3 py-2 font-mono text-[11.5px] text-ink-300">
                        {joinUrl}
                      </code>
                      <button
                        onClick={copyLink}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-800/15 bg-white px-3 py-2 text-[11.5px] font-medium transition hover:border-signal/40"
                      >
                        {copied ? (
                          <Check className="size-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className="mt-2 text-[11.5px] text-ink-500">
                      Or read them the code:{" "}
                      <span className="font-mono font-bold tracking-[0.18em] text-ink-200">
                        {active.joinCode}
                      </span>
                    </p>

                    <button
                      onClick={() => void launch(active)}
                      disabled={launching}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-signal px-3.5 py-2.5 text-[13px] font-semibold text-white shadow-card transition hover:brightness-105 disabled:opacity-60"
                    >
                      {launching ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <ArrowUpRight className="size-3.5" />
                      )}
                      Open {active.name} in a new tab
                    </button>
                  </div>

                  {/* ── Email, the optional convenience ────────────── */}
                  <label className="mb-1.5 block text-[12px] font-semibold text-ink-200">
                    Invite friends by email
                  </label>
                  <textarea
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    rows={2}
                    placeholder="sam@mit.edu, alex@mit.edu"
                    className="w-full resize-none rounded-xl border border-ink-800/15 bg-white px-3 py-2 text-[13px] outline-none focus:border-signal/50"
                  />
                  <button
                    onClick={invite}
                    disabled={inviting || !emails.trim()}
                    className="mt-2 flex items-center gap-1.5 rounded-xl border border-ink-800/15 bg-white px-3.5 py-2 text-[12px] font-medium transition hover:border-signal/40 disabled:opacity-50"
                  >
                    {inviting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Mail className="size-3.5" />
                    )}
                    Send invites
                  </button>

                  {/* Per-recipient truth. A 403 from the shared sender is a
                      real limit and reads as one, rather than vanishing. */}
                  {results && results.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5">
                      {results.map((r) => (
                        <div
                          key={r.email}
                          className={cn(
                            "rounded-lg px-3 py-2 text-[11.5px] leading-snug",
                            r.sent
                              ? "bg-emerald-50 text-emerald-900"
                              : "bg-amber-50 text-amber-900"
                          )}
                        >
                          <span className="font-semibold">{r.email}</span>
                          {r.sent ? (
                            " — emailed"
                          ) : (
                            <>
                              {" "}
                              — on the roster, not emailed.{" "}
                              <span className="opacity-80">{r.error}</span>
                            </>
                          )}
                        </div>
                      ))}
                      <p className="mt-0.5 text-[11px] text-ink-500">
                        Everyone above is already in the circle. Send them the
                        link if the email didn&apos;t land.
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
