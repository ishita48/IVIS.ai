"use client";

/**
 * A real-looking thread rather than a dashboard screenshot. The point of
 * this section is that studying with LENS still feels like people talking
 * to each other. Messages land one at a time as the thread scrolls into
 * view, LENS's line visually set apart without turning into a chat bubble.
 */

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

const MESSAGES = [
  { name: "Maya", text: "Why does this return None?" },
  { name: "Alex", text: "Look at line 12." },
  { name: "LENS", text: "Before checking the answer: what does the function return on every path?", lens: true },
  { name: "Priya", text: "Oh. The loop branch doesn't return anything at all." },
];

export function Collaboration() {
  return (
    <section id="collaboration" className="mx-auto w-full max-w-2xl px-6 py-24 sm:px-10 sm:py-32">
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-ink-500">Python functions · 4 studying</p>
        <h2 className="mt-4 text-balance text-[32px] font-extrabold tracking-tight text-ink-100 sm:text-[40px]">
          Learning is better together.
        </h2>
      </div>

      <div className="mt-16 space-y-6">
        {MESSAGES.map((m, i) => (
          <motion.div
            key={m.name + i}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.45, delay: (i % 2) * 0.08 }}
            className={cn(
              "flex items-start gap-3 rounded-2xl px-4 py-3",
              m.lens && "border-l-2 border-signal bg-signal/6"
            )}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold",
                m.lens ? "bg-signal text-white" : "bg-ink-800/10 text-ink-300"
              )}
            >
              {m.name[0]}
            </span>
            <div>
              <div className={cn("text-[11.5px] font-bold", m.lens ? "text-signal-deep" : "text-ink-200")}>
                {m.name}
              </div>
              <div className="mt-0.5 text-[14px] leading-relaxed text-ink-300">{m.text}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
