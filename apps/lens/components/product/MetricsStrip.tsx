"use client";

/**
 * MetricsStrip — the numbers, live, during the demo.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 4.
 *
 * "Direct answers: 0" is the single number that proves the product thesis,
 * so it goes first and it is styled to be readable from the back of a
 * room. It is a query result over the events collection, not a constant.
 *
 * A strip, not a dashboard page. Judges watch the demo; they do not
 * navigate to an analytics tab.
 */

import { useEvents } from "@/hooks/useEvents";

export function MetricsStrip() {
  const { metrics } = useEvents();
  if (!metrics) return null;

  const checks = metrics.understandingChecksAsked;
  const correct = metrics.understandingChecksCorrect;

  return (
    <div className="flex items-center gap-4 overflow-x-auto px-4 py-2 text-[11px] scrollbar-slim">
      <Metric
        label="Direct answers given"
        value={String(metrics.directAnswersGiven)}
        highlight={metrics.directAnswersGiven === 0}
      />
      <Divider />
      <Metric label="Hints issued" value={String(metrics.hintsIssued)} />
      <Metric
        label="Hint depth"
        value={metrics.deepestHintLevel?.toLowerCase() ?? "—"}
      />
      <Divider />
      <Metric
        label="Understanding checks"
        value={checks ? `${correct}/${checks}` : "—"}
      />
      <Metric
        label="Mix-ups caught"
        value={
          metrics.misconceptionsDetected
            ? `${metrics.misconceptionsResolved}/${metrics.misconceptionsDetected} resolved`
            : "—"
        }
      />
      <Divider />
      <Metric label="Vision calls" value={String(metrics.visionCalls)} />
      <Metric label="Voice turns" value={String(metrics.voiceTurns)} />
      <Metric
        label="Latency p50 / p95"
        value={
          metrics.visionLatencyMsP50
            ? `${metrics.visionLatencyMsP50} / ${metrics.visionLatencyMsP95}ms`
            : "—"
        }
      />
      <Metric
        label="Model calls skipped"
        value={String(metrics.modelCallsSkipped)}
        highlight={metrics.modelCallsSkipped > 0}
      />
      <Metric label="Tokens spent" value={String(metrics.tokensSpent)} />
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col">
      <span className="text-[9px] uppercase tracking-[0.12em] text-ink-500">
        {label}
      </span>
      <span
        className={
          highlight
            ? "text-[14px] font-semibold text-emerald-600"
            : "text-[13px] font-medium text-ink-200"
        }
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <span className="h-6 w-px shrink-0 bg-ink-800/15" />;
}
