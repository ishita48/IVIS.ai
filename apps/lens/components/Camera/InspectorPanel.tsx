"use client";

/**
 * InspectorPanel — what LENS is actually doing, as it does it.
 *
 * The visible UI shows conclusions: a box, a sentence, a confidence number.
 * That is enough to notice something is wrong and never enough to tell you
 * WHY. A box on the wrong object is either the model localizing badly or the
 * overlay mapping badly, and those have different fixes. This panel shows the
 * raw record so the question is read off rather than guessed at.
 *
 * It doubles as demo evidence: the log makes it visible that the AGENT chose
 * to look, rather than a timer or a button press.
 */

import { useState } from "react";

export type InspectorEvent = {
  id: string;
  at: number;
  kind: "tool" | "vision" | "agent" | "error";
  label: string;
  /** Raw payload, rendered as JSON when expanded. */
  detail?: unknown;
};

const KIND_STYLE: Record<InspectorEvent["kind"], string> = {
  tool: "text-signal-deep",
  vision: "text-ink-300",
  agent: "text-ink-500",
  error: "text-rose-700",
};

const clock = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", { hour12: false });

export function InspectorPanel({
  events,
  onClear,
}: {
  events: InspectorEvent[];
  onClear: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(events, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-3xl glass-panel">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-500 transition hover:text-ink-300"
        >
          <span className={`transition ${open ? "rotate-90" : ""}`}>›</span>
          Inspector
          {events.length > 0 && <span className="text-ink-600">({events.length})</span>}
        </button>

        {open && events.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded-full glass-chip px-2.5 py-1 text-[11px] text-ink-400 transition hover:text-ink-100"
            >
              {copied ? "copied" : "copy json"}
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded-full glass-chip px-2.5 py-1 text-[11px] text-ink-400 transition hover:text-ink-100"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {open && (
        <>
          <div className="mx-4 h-px glass-divider" />
          <div className="max-h-72 overflow-y-auto px-4 py-3">
            {events.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-ink-500">
                Nothing yet. Every tool the agent calls, every frame it reads, and every
                decision it makes lands here with its raw payload.
              </p>
            ) : (
              <ul className="space-y-1">
                {events.map((event) => {
                  const isOpen = expanded === event.id;
                  return (
                    <li key={event.id} className="font-mono text-[11px] leading-relaxed">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : event.id)}
                        disabled={event.detail === undefined}
                        className="flex w-full items-start gap-2 text-left disabled:cursor-default"
                      >
                        <span className="shrink-0 text-ink-600">{clock(event.at)}</span>
                        <span className={`${KIND_STYLE[event.kind]} break-all`}>
                          {event.label}
                        </span>
                      </button>

                      {isOpen && event.detail !== undefined && (
                        <pre className="mt-1 overflow-x-auto rounded-lg bg-ink-100/5 p-2 text-[10px] text-ink-400">
                          {JSON.stringify(event.detail, null, 2)}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
