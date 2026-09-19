"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, Trash2 } from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";

export function ChatSidebar() {
  const { sidebarOpen, pastSessions, sessionId, switchSession, deleteSession } =
    useLens();

  return (
    <AnimatePresence initial={false}>
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 232, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex shrink-0 flex-col overflow-hidden rounded-3xl glass-panel"
        >
          <div className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            Sessions
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 scrollbar-slim">
            {pastSessions.length === 0 && (
              <p className="px-2 text-[12px] text-ink-500">No sessions yet.</p>
            )}
            {pastSessions.map((s) => (
              <div
                key={s._id}
                className={cn(
                  "group flex items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] transition",
                  sessionId === s._id
                    ? "bg-signal/10 text-ink-100"
                    : "text-ink-400 hover:bg-white/50"
                )}
              >
                <MessageSquare className="size-3.5 shrink-0 opacity-60" />
                <button
                  onClick={() => switchSession(s._id)}
                  className="min-w-0 flex-1 truncate text-left"
                >
                  {s.title}
                </button>
                <button
                  onClick={() => deleteSession(s._id)}
                  className="opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                  aria-label="Delete session"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
