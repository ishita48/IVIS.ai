"use client";

/**
 * Split-screen instead of a card: the pitch on the left, a live-feeling
 * count of a teacher's morning on the right. Numbers tween up from zero
 * the moment the section enters view rather than rendering static —
 * that's the one piece of "dashboard" the brief asked to keep, so it gets
 * to actually feel alive.
 */

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { Check } from "lucide-react";

const CAPABILITIES = [
  "Create classes",
  "Share resources",
  "Create study sessions",
  "Share code",
  "Create coding challenges",
  "Monitor participation",
];

const STATS = [
  { n: 32, label: "students active" },
  { n: 4, label: "study sessions" },
  { n: 18, label: "questions asked" },
];

const DIFFICULTIES = [
  { topic: "Return values", pct: 62 },
  { topic: "Recursion base cases", pct: 41 },
  { topic: "Off-by-one loops", pct: 28 },
];

function useCountUp(target: number, active: boolean, duration = 1100) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);
  return value;
}

function Stat({ n, label, active }: { n: number; label: string; active: boolean }) {
  const value = useCountUp(n, active);
  return (
    <div>
      <div className="text-[30px] font-extrabold leading-none text-signal-deep sm:text-[36px]">{value}</div>
      <div className="mt-1.5 text-[11.5px] leading-tight text-ink-500">{label}</div>
    </div>
  );
}

export function TeacherSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });

  return (
    <section id="teachers" className="mx-auto w-full max-w-6xl px-6 py-24 sm:px-10 sm:py-32">
      <div className="grid items-start gap-14 lg:grid-cols-2 lg:gap-20">
        <div>
          <h2 className="text-balance text-[32px] font-extrabold leading-[1.08] tracking-tight text-ink-100 sm:text-[42px]">
            See where students are stuck before they stop asking.
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-400">
            LENS isn't only a student tool. Set up a class, watch understanding in real time, and
            get students the right kind of help before they get stuck for good.
          </p>
          <ul className="mt-8 space-y-2.5">
            {CAPABILITIES.map((c) => (
              <li key={c} className="flex items-center gap-2.5 text-[13.5px] font-medium text-ink-200">
                <Check className="size-3.5 shrink-0 text-signal-deep" />
                {c}
              </li>
            ))}
          </ul>
        </div>

        <div ref={ref} className="border-t border-ink-800/12 pt-8">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500">Today</div>
          <div className="mt-5 grid grid-cols-3 gap-6">
            {STATS.map((s) => (
              <Stat key={s.label} n={s.n} label={s.label} active={inView} />
            ))}
          </div>

          <div className="mt-10 text-[10.5px] font-bold uppercase tracking-wider text-ink-500">
            Common difficulties
          </div>
          <div className="mt-4 space-y-3.5">
            {DIFFICULTIES.map((d) => (
              <div key={d.topic}>
                <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
                  <span className="font-medium text-ink-200">{d.topic}</span>
                  <span className="text-ink-500">{d.pct}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-ink-800/10">
                  <div
                    className="h-full rounded-full bg-signal/70 transition-[width] duration-[1100ms] ease-out"
                    style={{ width: inView ? `${d.pct}%` : "0%" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
