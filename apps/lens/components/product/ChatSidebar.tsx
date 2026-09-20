"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Trash2 } from "lucide-react";
import { useLens, type SessionMeta } from "@/lib/store";
import { cn } from "@/lib/cn";
import { SmallStepsAccordion } from "./SmallStepsAccordion";

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
          className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-ink-800/12 bg-white/70 shadow-soft"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
              Recent Sessions
            </span>
            <ChevronRight className="size-3 text-ink-500" />
          </div>
          <div className="mx-4 h-px bg-ink-800/10" />
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2 scrollbar-slim">
            {pastSessions.length === 0 && (
              <p className="px-2.5 py-2 text-[12px] text-ink-500">No sessions yet.</p>
            )}
            {pastSessions.map((s: SessionMeta) => {
              const active = sessionId === s._id;
              return (
                <div
                  key={s._id}
                  className={cn(
                    "group relative flex items-center gap-2.5 border-l-2 px-3 py-2.5 text-[12px] transition",
                    active ? "border-signal bg-signal/6" : "border-transparent hover:bg-ink-800/[0.03]"
                  )}
                >
                  <button onClick={() => switchSession(s._id)} className="min-w-0 flex-1 text-left">
                    <div className={cn("truncate font-semibold", active ? "text-signal-deep" : "text-ink-100")}>
                      {s.title}
                    </div>
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

          <SmallStepsAccordion />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
