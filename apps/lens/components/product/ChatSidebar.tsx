"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Clock, MessageSquare, Trash2 } from "lucide-react";
import { useLens, type SessionMeta } from "@/lib/store";
import { cn } from "@/lib/cn";

// A small, deterministic accent per session so the list reads as distinct
// cards instead of a flat stack — derived from the id, not stored anywhere.
const AVATAR_HUES = ["#E06646", "#E88A71", "#B03D21", "#EFB4A3", "#90341F"];
function avatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

function relativeTime(iso?: string) {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const now = new Date();
  const sameDay = then.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = then.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today · ${time}`;
  if (then.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;
  return `${then.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${time}`;
}

export function ChatSidebar() {
  const { sidebarOpen, pastSessions, sessionId, switchSession, deleteSession } =
    useLens();

  return (
    <AnimatePresence initial={false}>
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 252, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex shrink-0 flex-col overflow-hidden rounded-3xl glass-panel"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
              <Clock className="size-3" />
              Recent Sessions
            </span>
            <ChevronRight className="size-3 text-ink-500" />
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-2.5 scrollbar-slim">
            {pastSessions.length === 0 && (
              <p className="px-2 text-[12px] text-ink-500">No sessions yet.</p>
            )}
            {pastSessions.map((s: SessionMeta) => {
              const active = sessionId === s._id;
              const color = avatarColor(s._id);
              return (
                <div
                  key={s._id}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-[12px] transition",
                    active
                      ? "border border-signal/40 bg-signal/10 shadow-card"
                      : "border border-transparent hover:bg-white/50"
                  )}
                >
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ background: active ? color : `${color}55` }}
                  >
                    <MessageSquare className="size-4" strokeWidth={1.6} />
                  </div>
                  <button
                    onClick={() => switchSession(s._id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate font-semibold text-ink-100">{s.title}</div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-500">
                      {relativeTime(s.updatedAt || s.createdAt)}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteSession(s._id)}
                    className="opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                    aria-label="Delete session"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="m-2.5 mt-0 rounded-2xl border border-white/60 bg-white/40 p-3.5">
            <div className="text-[11.5px] font-bold leading-snug text-ink-100">
              Small steps.
              <br />
              Big understanding.
            </div>
            <svg width="100%" height="20" viewBox="0 0 200 20" fill="none" className="mt-2 opacity-40">
              <path
                d="M2 16C24 16 32 5 48 5C64 5 72 13 88 10C104 7 116 4 136 4C156 4 168 12 198 8"
                stroke="#E06646"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
