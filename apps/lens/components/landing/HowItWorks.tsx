"use client";

/**
 * Vertical scroll drives a horizontal sequence: the wrapper is four
 * viewport-heights tall so there's scroll distance to spend, the inner
 * track stays pinned via `sticky` while it slides left underneath it.
 * Same four beats as the product itself: show, observe, question, discover,
 * told as a scroll rather than a bullet list.
 */

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Camera, ScanEye, MessageCircleQuestion, Sparkles } from "lucide-react";

const STEPS = [
  {
    n: "01",
    label: "Show",
    icon: Camera,
    title: "Show LENS what you're working on.",
    body: "Camera, notes, code, a diagram: point it at whatever you're actually stuck on.",
  },
  {
    n: "02",
    label: "Observe",
    icon: ScanEye,
    title: "LENS looks at your work.",
    body: "It reads what's in front of you, not a description of it.",
  },
  {
    n: "03",
    label: "Question",
    icon: MessageCircleQuestion,
    title: "LENS asks the next question.",
    body: "Not the answer. The question that gets you one step closer to it.",
  },
  {
    n: "04",
    label: "Discover",
    icon: Sparkles,
    title: "You figure it out.",
    body: "",
  },
];

export function HowItWorks() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: wrapperRef, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0, 1], ["0%", `-${(STEPS.length - 1) * 100}%`]);

  return (
    <section id="how-it-works" className="relative">
      <div ref={wrapperRef} style={{ height: `${STEPS.length * 100}vh` }}>
        <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden">
          <p className="px-6 text-[16px] font-extrabold uppercase tracking-[0.18em] text-ink-200 sm:px-10 sm:text-[19px] lg:px-24">
            How LENS works
          </p>
          <motion.div style={{ x }} className="mt-6 flex h-full items-center">
            {STEPS.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.n} className="flex h-full w-screen shrink-0 items-center gap-6 px-6 sm:px-10 lg:gap-12 lg:px-24">
                  <div className="max-w-2xl shrink-0">
                    <div className="flex items-center gap-3 text-signal-deep">
                      <Icon className="size-6" />
                      <span className="text-[13px] font-bold uppercase tracking-[0.2em]">
                        {s.n} · {s.label}
                      </span>
                    </div>
                    <h3 className="mt-5 text-balance text-[10vw] font-extrabold leading-[1.02] tracking-tight text-ink-100 sm:text-[52px]">
                      {s.title}
                    </h3>
                    {s.body && (
                      <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-400">{s.body}</p>
                    )}
                  </div>
                  <span
                    aria-hidden
                    className="hidden select-none text-[22vw] font-extrabold leading-none text-ink-900 lg:block"
                  >
                    {s.n}
                  </span>
                </div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
