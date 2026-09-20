"use client";

/**
 * MetricsStrip — the numbers, live, during the demo.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 4.
 *
 * "Direct answers given: 0" is the single number that proves the product
 * thesis, so it goes first and it is styled to be readable from the back
 * of a room. It is a query result over the events collection, not a
 * constant.
 *
 * A status line, not a dashboard page and not navigation. It sits under
 * the TopBar on the canvas itself — no panel, no pill — so judges read it
 * as proof running alongside the demo rather than as another place to
 * click. It stays on screen the whole time; before the first event it
 * holds its height with a one-line explanation instead of vanishing.
 */

import { useEvents } from "@/hooks/useEvents";

export function MetricsStrip() {
  const { metrics } = useEvents();

  if (!metrics) {
    return (
      <Line>
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink-700" />
        <span className="shrink-0">
          No events yet. Every number here is a query over this session&apos;s recorded events.
        </span>
      </Line>
    );
  }

  const checks = metrics.understandingChecksAsked;
  const correct = metrics.understandingChecksCorrect;
  const noAnswers = metrics.directAnswersGiven === 0;

  return (
    <Line>
      <span
        className="flex shrink-0 items-center gap-1.5 font-medium text-ink-400"
        title="Every number is a query over this session's recorded events"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
        Live
      </span>

      <Divider />

      {/* The thesis number. */}
      <span className="flex shrink-0 items-baseline gap-2">
        <span>Direct answers given</span>
        <span
          className={
            noAnswers
              ? "text-[16px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
              : "text-[16px] font-semibold tabular-nums text-ink-100"
          }
        >
          {metrics.directAnswersGiven}
        </span>
      </span>

      <Divider />

      <Metric label="Hints" value={String(metrics.hintsIssued)} />
      <Metric label="Deepest rung" value={metrics.deepestHintLevel?.toLowerCase() ?? "—"} />

      <Divider />

      <Metric label="Understanding checks" value={checks ? `${correct}/${checks}` : "—"} />
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
            ? `${metrics.visionLatencyMsP50} / ${metrics.visionLatencyMsP95} ms`
            : "—"
        }
      />
      <Metric
        label="Model calls skipped"
        value={String(metrics.modelCallsSkipped)}
        highlight={metrics.modelCallsSkipped > 0}
      />
      <Metric label="Tokens spent" value={metrics.tokensSpent.toLocaleString()} />
    </Line>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-label="Live session metrics"
      className="mx-3 flex h-8 shrink-0 items-center gap-x-4 overflow-x-auto px-4 text-[11px] leading-none text-ink-500 scrollbar-slim"
    >
      {children}
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
    <span className="flex shrink-0 items-baseline gap-1.5">
      <span>{label}</span>
      <span
        className={
          highlight
            ? "text-[12px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
            : "text-[12px] font-medium tabular-nums text-ink-200"
        }
      >
        {value}
      </span>
    </span>
  );
}

function Divider() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-ink-800/60" />;
}
