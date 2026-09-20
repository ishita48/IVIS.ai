"use client";

/**
 * ClassPicker — real classes, and the invite flow.
 *
 * There is no seeded class and no sample roster. A new teacher sees an
 * empty state and creates one; the join code is generated server-side and
 * is what actually admits a student.
 *
 * Invites add the student to the roster FIRST and attempt email second, so
 * the flow still works with no RESEND_API_KEY — which is the state this
 * ships in. The panel then shows the link to copy rather than pretending
 * mail went out.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Mail,
  Plus,
  Users,
} from "lucide-react";

export type TeacherClass = {
  _id: string;
  name: string;
  topic: string;
  joinCode: string;
  students: number;
  isOwner: boolean;
};

export function ClassPicker({
  selected,
  onSelect,
}: {
  selected: TeacherClass | null;
  onSelect: (c: TeacherClass | null) => void;
}) {
  const [classes, setClasses] = useState<TeacherClass[] | null>(null);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [emails, setEmails] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    added: number;
    sent: number;
    emailConfigured: boolean;
    joinUrl: string;
    results: { email: string; sent: boolean; error?: string }[];
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/classes", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        classes?: TeacherClass[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not load classes.");
      setClasses(data.classes ?? []);
      if (!selected && data.classes?.length) onSelect(data.classes[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load classes.");
      setClasses([]);
    }
    // onSelect/selected deliberately omitted: this should run on mount and
    // after a create, not every time the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, topic }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        class?: TeacherClass;
        error?: string;
      };
      if (!res.ok || !data.class) throw new Error(data.error || "Could not create.");
      setName("");
      setTopic("");
      setClasses((prev) => [data.class!, ...(prev ?? [])]);
      onSelect(data.class);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create.");
    } finally {
      setBusy(false);
    }
  };

  const invite = async () => {
    if (!selected || !emails.trim()) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await fetch(`/api/classes/${selected._id}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not invite.");
      setInviteResult(data);
      setEmails("");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invite.");
    } finally {
      setInviting(false);
    }
  };

  const joinUrl =
    selected && typeof window !== "undefined"
      ? `${window.location.origin}/join/${selected.joinCode}`
      : "";

  return (
    <div className="flex flex-col gap-4 rounded-3xl glass-panel p-6">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-100">
        <Users className="size-4 text-signal-deep" />
        Your classes
      </h2>

      {error && (
        <div className="rounded-xl border border-rose-300/40 bg-rose-50/60 p-3 text-[12px] text-rose-700">
          {error}
        </div>
      )}

      {classes === null ? (
        <div className="flex items-center gap-2 py-3 text-[13px] text-ink-500">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : classes.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink-500">
          No classes yet. Create one below — you&apos;ll get a join code to give
          your students.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {classes.map((c) => (
            <button
              key={c._id}
              onClick={() => onSelect(c)}
              className={`rounded-xl border px-3 py-2 text-left text-[12px] transition ${
                selected?._id === c._id
                  ? "border-signal/50 bg-signal/10"
                  : "border-ink-800/15 bg-white/50 hover:bg-white/80"
              }`}
            >
              <div className="font-semibold text-ink-100">{c.name}</div>
              <div className="text-ink-500">
                {c.students} student{c.students === 1 ? "" : "s"} · code {c.joinCode}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── Create ───────────────────────────────────────────── */}
      <div className="grid gap-2 border-t border-white/50 pt-4 sm:grid-cols-[1fr_1fr_auto]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Class name"
          className="rounded-xl border border-ink-800/15 bg-white/60 px-3 py-2 text-[13px] outline-none focus:border-signal/50"
        />
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Current topic (optional)"
          className="rounded-xl border border-ink-800/15 bg-white/60 px-3 py-2 text-[13px] outline-none focus:border-signal/50"
        />
        <button
          onClick={() => void create()}
          disabled={busy || !name.trim()}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-signal px-4 py-2 text-[12px] font-semibold text-ink-950 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Create
        </button>
      </div>

      {/* ── Invite ───────────────────────────────────────────── */}
      {selected && (
        <div className="border-t border-white/50 pt-4">
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-ink-100">
            <Mail className="size-3.5 text-signal-deep" />
            Add students to {selected.name}
          </h3>

          <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/50 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-[12px] text-ink-300">
              {joinUrl}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(joinUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-ink-800/15 px-2 py-1 text-[11px] text-ink-400 transition hover:text-ink-100"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          <textarea
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            rows={2}
            placeholder="Paste student emails — commas, spaces or new lines"
            className="w-full rounded-xl border border-ink-800/15 bg-white/60 px-3 py-2 text-[13px] outline-none focus:border-signal/50"
          />
          <button
            onClick={() => void invite()}
            disabled={inviting || !emails.trim()}
            className="mt-2 flex items-center gap-1.5 rounded-xl bg-signal px-4 py-2 text-[12px] font-semibold text-ink-950 disabled:opacity-40"
          >
            {inviting ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
            Add and email
          </button>

          {inviteResult && (
            <div className="mt-3 rounded-xl bg-white/50 p-3 text-[12px]">
              <p className="font-medium text-ink-200">
                {inviteResult.added} added to the roster
                {inviteResult.emailConfigured
                  ? ` · ${inviteResult.sent} email${inviteResult.sent === 1 ? "" : "s"} sent`
                  : ""}
              </p>
              {!inviteResult.emailConfigured && (
                <p className="mt-1 text-ink-500">
                  Email is off (no RESEND_API_KEY) — they&apos;re on the roster,
                  so send them the link above.
                </p>
              )}
              {inviteResult.results
                .filter((r) => !r.sent && r.error)
                .slice(0, 3)
                .map((r) => (
                  <p key={r.email} className="mt-1 text-amber-700">
                    {r.email}: {r.error}
                  </p>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
