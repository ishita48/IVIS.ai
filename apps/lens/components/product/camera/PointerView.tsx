"use client";

/**
 * PointerView — LENS Pointer, screen mode.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 3.
 *
 * Ask a question about whatever is on your screen; LENS captures it once,
 * runs a real Computer Use call, and shows where to look. It does not
 * answer the question — pointing IS the L1 rung of the ladder.
 *
 * The preview below is the actual captured frame, with the bubble drawn
 * at the returned normalized coordinates, so what a judge sees on stage is
 * the model's real output over the real capture rather than an annotation
 * layer over a live element we could have positioned ourselves.
 */

import { useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, Mic, Square } from "lucide-react";
import { useLens } from "@/lib/store";
import { BubbleOverlay } from "./PointerOverlay";
import { useAgent } from "@/hooks/useAgent";

export function PointerView() {
  const { pointerTarget, pointing, pointAtScreen, clearPointer } = useLens();
  const [question, setQuestion] = useState("");
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const agent = useAgent({
    analyzeWorkspace: async (objective) => {
      const target = await pointAtScreen(objective);
      return {
        observation: target
          ? `I pointed at ${target.label} on the screen.`
          : "There was no specific screen target for that question.",
        objects: target ? [target.label] : [],
        confidence: target ? 0.9 : 0,
        changed: false,
      };
    },
    setPace: () => undefined,
    setMode: () => undefined,
    compareToReference: async () => ({ difference: "No reference comparison is loaded.", focus: "", confidence: 0, aligned: false }),
    noteMisconception: () => undefined,
    recordPrediction: (prediction) => { void useLens.getState().recordEvent("prediction", { answer: prediction, source: "pointer-voice" }); },
    noteUnderstanding: () => undefined,
  });

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent.transcript.length]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && question.trim() && !pointing) {
              pointAtScreen(question.trim());
            }
          }}
          placeholder="Ask about something on your screen — “which line is failing?”"
          className="min-w-0 flex-1 rounded-xl border border-ink-800/15 bg-white/60 px-3 py-2 text-[13px] outline-none backdrop-blur focus:border-signal/50"
        />
        <button
          disabled={!question.trim() || pointing}
          onClick={() => pointAtScreen(question.trim())}
          className="flex items-center gap-2 rounded-xl bg-signal px-4 py-2 text-[13px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white disabled:opacity-40"
        >
          {pointing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Crosshair className="size-4" />
          )}
          Point at it
        </button>
        <button
          type="button"
          onClick={() => (agent.status === "connected" ? agent.stop() : void agent.start())}
          disabled={agent.phase === "connecting"}
          title="Talk with LENS about the captured screen"
          className="flex items-center gap-2 rounded-xl border border-ink-800/15 px-3 py-2 text-[13px] transition hover:border-signal/40 disabled:opacity-40"
        >
          {agent.status === "connected" ? <Square className="size-3.5" /> : <Mic className="size-3.5" />}
          {agent.status === "connected" ? "Stop talking" : "Talk to LENS"}
        </button>
      </div>

      {agent.transcript.length > 0 && (
        <div className="max-h-28 overflow-y-auto rounded-xl border border-ink-800/10 bg-white/40 px-3 py-2 text-[12px]">
          {agent.transcript.slice(-4).map((entry) => (
            <p key={entry.id} className="mb-1 last:mb-0">
              <span className="mr-2 uppercase text-[9px] text-ink-500">{entry.role}</span>{entry.text}
            </p>
          ))}
          <div ref={transcriptEnd} />
        </div>
      )}

      {agent.error && <p className="text-[12px] text-rose-600">{agent.error}</p>}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-ink-800/15 bg-ink-900/60">
        {pointerTarget ? (
          <div className="relative h-full w-full">
            <BubbleOverlay target={pointerTarget} />
            <div className="absolute inset-x-0 bottom-0 bg-ink-100/90 px-4 py-3 text-[12px] text-ink-700">
              Computer Use returned ({pointerTarget.x}, {pointerTarget.y}) in a{" "}
              {pointerTarget.declared.width}×{pointerTarget.declared.height}{" "}
              declared space, rescaled to your real screen.
              <button
                onClick={clearPointer}
                className="ml-2 underline hover:text-white"
              >
                clear
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <Crosshair className="size-10 text-ink-600" />
            <p className="max-w-sm text-[13px] leading-relaxed text-ink-500">
              Ask a question and LENS will ask your browser for a one-frame
              screen capture, then point at the exact element that matters. If
              your question is conceptual, it will tell you there&apos;s nothing
              to point at rather than guessing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
