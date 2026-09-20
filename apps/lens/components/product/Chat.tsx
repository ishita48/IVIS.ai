"use client";

/**
 * Chat — the LENS tutor panel.
 * ─────────────────────────────────────────────────────────────────────
 * Talks to /api/master/chat (SSE). The agent can emit tool calls that move
 * the workspace — see handleToolCall in lib/store.ts. It cannot fabricate
 * a vision result: asking for the camera opens the tab and waits for a
 * human tap.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Loader2 } from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";

export function Chat() {
  const { chat, typing, sendUserPrompt, setView, setAddSourceOpen } = useLens();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, typing]);

  function send(value?: string) {
    const v = (value ?? text).trim();
    if (!v || typing) return;
    setText("");
    if (v === "Add a source") {
      // Chip: go straight to the modal instead of chatting about it.
      setView("sources");
      setAddSourceOpen(true);
      return;
    }
    if (/camera/i.test(v)) setView("camera");
    sendUserPrompt(v);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 scrollbar-slim">
        {chat.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                m.role === "user"
                  ? "bg-signal text-ink-950"
                  : "border border-ink-800/10 bg-white/60 text-ink-200 backdrop-blur"
              )}
            >
              {m.text || (typing ? "…" : "")}
              {m.chips && m.chips.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.chips.map((c) => (
                    <button
                      key={c}
                      onClick={() => send(c)}
                      className="rounded-full border border-ink-800/15 px-2.5 py-1 text-[11px] transition hover:border-signal/50 hover:bg-signal/10"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {typing && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-ink-500">
            <Loader2 className="size-3.5 animate-spin" />
            thinking
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-ink-800/10 p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-ink-800/15 bg-white/60 px-3 py-2 backdrop-blur focus-within:border-signal/50">
          <textarea
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask me something. I won't answer it."
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-ink-500"
          />
          <button
            onClick={() => send()}
            disabled={!text.trim() || typing}
            className="rounded-full bg-signal p-1.5 text-ink-950 transition hover:bg-signal-deep hover:text-white disabled:opacity-30"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
