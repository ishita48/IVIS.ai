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

import { motion } from "framer-motion";
import { useEvents } from "@/hooks/useEvents";
import { cn } from "@/lib/cn";

export function MetricsStrip() {
  const { metrics } = useEvents();
  if (!metrics) return null;

  const checks = metrics.understandingChecksAsked;
  const correct = metrics.understandingChecksCorrect;

  return (
    <div className="flex items-center gap-4 overflow-x-auto px-4 py-1.5 text-[11px] scrollbar-slim">
      <Metric
        label="Direct answers given"
        value={String(metrics.directAnswersGiven)}
        pct={1}
        highlight={metrics.directAnswersGiven === 0}
      />
      <Divider />
      <Metric label="Hints issued" value={String(metrics.hintsIssued)} pct={1} />
      <Metric
        label="Hint depth"
        value={metrics.deepestHintLevel?.toLowerCase() ?? "—"}
        pct={metrics.deepestHintLevel ? 1 : 0.15}
      />
      <Divider />
      <Metric
        label="Understanding checks"
        value={checks ? `${correct}/${checks}` : "—"}
        pct={checks ? correct / checks : 0.15}
      />
      <Metric
        label="Mix-ups caught"
        value={
          metrics.misconceptionsDetected
            ? `${metrics.misconceptionsResolved}/${metrics.misconceptionsDetected} resolved`
            : "—"
        }
        pct={
          metrics.misconceptionsDetected
            ? metrics.misconceptionsResolved / metrics.misconceptionsDetected
            : 0.15
        }
      />
      <Divider />
      <Metric
        label="Model calls avoided"
        value={String(metrics.modelCallsAvoided)}
        pct={1}
        highlight={metrics.modelCallsAvoided > 0}
      />
      <Metric label="Diagnoses rejected" value={String(metrics.diagnosesRejected)} pct={1} />
      <Divider />
      <Metric label="Vision calls" value={String(metrics.visionCalls)} pct={1} />
      <Metric label="Voice turns" value={String(metrics.voiceTurns)} pct={1} />
      <Metric
        label="Latency p50 / p95"
        value={
          metrics.visionLatencyMsP50
            ? `${metrics.visionLatencyMsP50} / ${metrics.visionLatencyMsP95}ms`
            : "—"
        }
        pct={metrics.visionLatencyMsP50 ? 1 : 0.15}
      />
      <Metric
        label="Model calls skipped"
        value={String(metrics.modelCallsSkipped)}
        pct={1}
        highlight={metrics.modelCallsSkipped > 0}
      />
      <Metric label="Tokens spent" value={String(metrics.tokensSpent)} pct={1} />
    </div>
  );
}

/** A small arc — a tracking indicator settling into focus, not a progress bar. */
function MetricArc({ pct, highlight }: { pct: number; highlight?: boolean }) {
  const d = "M 3 15 A 13 13 0 0 1 29 15";
  return (
    <svg width="32" height="16" viewBox="0 0 32 16" className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-800/10" strokeLinecap="round" />
      <motion.path
        d={d}
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        className={highlight ? "text-emerald-500" : "text-signal"}
        stroke="currentColor"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: Math.max(0, Math.min(1, pct)) }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </svg>
  );
}

function Metric({
  label,
  value,
  pct,
  highlight,
}: {
  label: string;
  value: string;
  pct: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5">
      <span className="whitespace-nowrap text-[9px] uppercase tracking-[0.12em] text-ink-500">
        {label}
      </span>
      <MetricArc pct={pct} highlight={highlight} />
      <span
        className={cn(
          "-mt-1.5 whitespace-nowrap text-[12px] font-semibold",
          highlight ? "text-emerald-600" : "text-ink-200"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <span className="h-8 w-px shrink-0 bg-ink-800/15" />;
}
