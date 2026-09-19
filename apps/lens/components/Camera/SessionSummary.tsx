"use client";

/**
 * SessionSummary — what the student actually got, after the session ends.
 *
 * The curve is not a fabricated engagement score. Every point is a
 * note_understanding call the tutor made during the session, with its own
 * one-line evidence attached. LENS is grading its read of you, and showing
 * its working, which is the only version of this that is honest.
 *
 * An empty session says so rather than drawing a flat line at zero.
 */

import type { UnderstandingNote } from "@/hooks/useAgent";

const W = 560;
const H = 150;
const PAD = { top: 14, right: 14, bottom: 22, left: 30 };

export function SessionSummary({
  notes,
  looks,
  predictions,
  onDismiss,
}: {
  notes: UnderstandingNote[];
  looks: number;
  predictions: number;
  onDismiss: () => void;
}) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const points = notes.map((note, i) => ({
    ...note,
    x: PAD.left + (notes.length === 1 ? plotW / 2 : (i / (notes.length - 1)) * plotW),
    y: PAD.top + (1 - note.level) * plotH,
  }));

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const first = notes[0]?.level ?? 0;
  const last = notes[notes.length - 1]?.level ?? 0;
  const delta = last - first;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="rounded-3xl glass-panel p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-100">Session summary</h2>
          <p className="mt-0.5 text-[12px] text-ink-500">
            {notes.length > 0
              ? `LENS read your understanding ${notes.length} time${notes.length === 1 ? "" : "s"} while you worked.`
              : "Not enough evidence to judge understanding this session."}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full glass-chip px-3 py-1.5 text-[12px] text-ink-400 transition hover:text-ink-100"
        >
          Close
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="rounded-2xl bg-ink-100/[0.03] px-4 py-6 text-center text-[13px] text-ink-500">
          LENS only scores what it saw evidence for. Work through something with it
          and the curve appears here.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-5 text-[12px]">
            <Stat label="ended at" value={pct(last)} strong />
            <Stat
              label="change"
              value={`${delta >= 0 ? "+" : ""}${pct(delta)}`}
              strong={delta !== 0}
            />
            <Stat label="looks" value={String(looks)} />
            <Stat label="predictions" value={String(predictions)} />
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
               aria-label={`Understanding rose from ${pct(first)} to ${pct(last)}`}>
            {[0, 0.5, 1].map((t) => {
              const y = PAD.top + (1 - t) * plotH;
              return (
                <g key={t}>
                  <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                        stroke="#0B1220" strokeOpacity={0.08} strokeWidth={1} />
                  <text x={PAD.left - 6} y={y + 3} textAnchor="end"
                        fontSize={9} fill="#97A5B0">{pct(t)}</text>
                </g>
              );
            })}

            <defs>
              <linearGradient id="fadeUnder" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00C2A8" stopOpacity="0.20" />
                <stop offset="100%" stopColor="#00C2A8" stopOpacity="0" />
              </linearGradient>
            </defs>

            {points.length > 1 && (
              <path
                d={`${path} L ${points[points.length - 1].x.toFixed(1)} ${PAD.top + plotH} L ${points[0].x.toFixed(1)} ${PAD.top + plotH} Z`}
                fill="url(#fadeUnder)"
              />
            )}

            {points.length > 1 && (
              <path d={path} fill="none" stroke="#00C2A8" strokeWidth={2.5}
                    strokeLinecap="round" strokeLinejoin="round" />
            )}

            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill="#00C2A8"
                      stroke="#FFFFFF" strokeWidth={1.5}>
                <title>{`${p.topic} — ${pct(p.level)}\n${p.why}`}</title>
              </circle>
            ))}
          </svg>

          <ul className="mt-4 space-y-2">
            {notes.map((note, i) => (
              <li key={i} className="flex gap-3 text-[12px]">
                <span className="w-9 shrink-0 font-mono text-signal-deep">
                  {pct(note.level)}
                </span>
                <span className="text-ink-300">
                  <span className="font-medium text-ink-200">{note.topic}</span>
                  {note.why ? ` — ${note.why}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-ink-500">{label}</span>
      <span className={strong ? "text-[16px] font-semibold text-ink-100" : "text-[16px] text-ink-300"}>
        {value}
      </span>
    </span>
  );
}
