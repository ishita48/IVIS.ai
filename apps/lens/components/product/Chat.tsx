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
import { ArrowUp, Loader2, Mic, Square } from "lucide-react";
import { useLens } from "@/lib/store";
import { useDictation } from "@/hooks/useDictation";
import { cn } from "@/lib/cn";

export function Chat() {
  const { chat, typing, sendUserPrompt, setView, setAddSourceOpen, pushToast } = useLens();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const dictation = useDictation();

  /**
   * Think-aloud. The transcript lands in the box rather than sending
   * straight off, so the student reads what was heard before it counts as
   * something they said — speech recognition is good, not infallible, and
   * a misheard prediction becomes evidence the reasoning engine then
   * reasons from.
   */
  async function toggleDictation() {
    if (dictation.recording) {
      const heard = await dictation.stop();
      if (heard) setText((prev) => (prev ? `${prev} ${heard}` : heard));
      return;
    }
    dictation.clearError();
    await dictation.start();
  }

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
    if (/^what can you see\??$/i.test(v)) {
      // Chip: this model has no eyes. The camera does — send them there.
      setView("camera");
      pushToast({ kind: "info", text: "Press Look and LENS will say what it sees." });
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

      <div className="shrink-0 p-3">
        <div className="flex items-end gap-2 rounded-full border border-ink-800/15 bg-white/60 py-2 pl-4 pr-2 backdrop-blur focus-within:border-signal/50">
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
            placeholder={
              dictation.recording
                ? "Listening — say what you're thinking…"
                : "Ask me something. I won't answer it."
            }
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-ink-500"
          />
          <button
            onClick={() => void toggleDictation()}
            disabled={dictation.busy || typing}
            title={
              dictation.recording
                ? "Stop and transcribe"
                : "Think aloud — your hands stay on your work"
            }
            aria-pressed={dictation.recording}
            className={cn(
              "rounded-full p-1.5 transition disabled:opacity-30",
              dictation.recording
                ? "bg-rose-500 text-white"
                : "text-ink-500 hover:text-ink-200"
            )}
          >
            {dictation.busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : dictation.recording ? (
              <Square className="size-4" />
            ) : (
              <Mic className="size-4" />
            )}
          </button>
          <button
            onClick={() => send()}
            disabled={!text.trim() || typing}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-signal text-white shadow-glow transition hover:bg-signal-deep disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>

        {(dictation.recording || dictation.busy || dictation.error) && (
          <p
            className={cn(
              "mt-1.5 px-1 text-[11px]",
              dictation.error ? "text-rose-500" : "text-ink-500"
            )}
          >
            {dictation.error ??
              (dictation.recording
                ? "Recording — tap the square when you're done."
                : "Transcribing…")}
            {dictation.lastMs && !dictation.error && !dictation.recording
              ? ` (${dictation.lastMs}ms)`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}
