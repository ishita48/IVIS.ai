"use client";

/**
 * LiveActivityPanel — snapshot of the active class session: understanding
 * split and the questions LENS is fielding right now.
 *
 * All numbers here are placeholder frontend state until there's a real
 * events feed to read from (see components/product/MetricsStrip.tsx for
 * the pattern the student side already uses for this once it's wired up).
 */

import { useEffect, useState } from "react";
import { CheckCircle2, Flag, HelpCircle, MessageCircle, Quote, UserCheck } from "lucide-react";

const BARS = [
  { key: "understanding", label: "Understanding", value: 72, icon: CheckCircle2, from: "from-emerald-400", to: "to-emerald-500", text: "text-emerald-600" },
  { key: "help", label: "Need help", value: 18, icon: HelpCircle, from: "from-amber-400", to: "to-amber-500", text: "text-amber-600" },
  { key: "finished", label: "Finished", value: 10, icon: Flag, from: "from-signal-soft", to: "to-signal", text: "text-signal-deep" },
] as const;

const QUESTIONS = [
  <>What's the difference between <code className="rounded bg-ink-900 px-1.5 py-0.5 text-[13px] text-signal-deep">return</code> and <code className="rounded bg-ink-900 px-1.5 py-0.5 text-[13px] text-signal-deep">print</code>?</>,
  <>Why is my function returning <code className="rounded bg-ink-900 px-1.5 py-0.5 text-[13px] text-signal-deep">None</code>?</>,
];

export function LiveActivityPanel({ topic, online }: { topic: string; online: number }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 150);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col gap-6 rounded-3xl glass-panel p-6 sm:p-8 lg:col-span-2">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-white/50 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-3 text-[20px] font-bold text-ink-100">
            <span className="relative flex size-3.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex size-3.5 rounded-full border-2 border-white bg-rose-500" />
            </span>
            Live Class Activity
          </h2>
          <h3 className="mt-1 text-[15px] font-medium text-ink-400">
            Topic: <span className="font-semibold text-ink-100">{topic}</span>
          </h3>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-[13px] font-semibold text-emerald-600">
          <UserCheck className="size-4" />
          {online} students online
        </div>
      </div>

      {/* Status bars */}
      <div className="space-y-5">
        {BARS.map((b) => {
          const Icon = b.icon;
          return (
            <div key={b.key}>
              <div className="mb-2 flex items-end justify-between">
                <span className="flex items-center gap-2 text-[13px] font-bold text-ink-200">
                  <Icon className={`size-4 ${b.text}`} />
                  {b.label}
                </span>
                <span className={`text-[16px] font-bold ${b.text}`}>{b.value}%</span>
              </div>
              <div className="h-3.5 w-full rounded-full border border-white/60 bg-white/40 shadow-inner">
                <div
                  className={`h-3.5 rounded-full bg-gradient-to-r ${b.from} ${b.to} transition-[width] duration-[1000ms] ease-out`}
                  style={{ width: animated ? `${b.value}%` : "0%" }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Common questions */}
      <div className="rounded-2xl glass p-5 sm:p-6">
        <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-ink-100">
          <MessageCircle className="size-4 text-signal-deep" />
          LENS Automated Intercepts
        </h3>
        <p className="mb-3.5 text-[13px] text-ink-400">
          Common questions students are asking the AI tutor right now:
        </p>
        <ul className="space-y-2.5">
          {QUESTIONS.map((q, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-white/70 bg-white/60 p-3.5 shadow-card transition hover:shadow-lift"
            >
              <div className="mt-0.5 shrink-0 rounded-lg bg-signal/12 p-1.5 text-signal-deep">
                <Quote className="size-3" />
              </div>
              <span className="text-[13px] font-medium leading-relaxed text-ink-200">{q}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
