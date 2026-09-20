"use client";

/**
 * Replaces the old welcome card. Same job — orient a first-time student
 * and hand them the two starting moves — but collapsed by default so it
 * reads as a sidebar utility, not the first thing competing for attention.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";

export function SmallStepsAccordion() {
  const [open, setOpen] = useState(false);
  const setView = useLens((s) => s.setView);
  const setAddSourceOpen = useLens((s) => s.setAddSourceOpen);

  return (
    <div className="m-2.5 mt-0 shrink-0 rounded-lg border border-ink-800/12 bg-white/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left"
      >
        <span className="text-[11px] font-bold uppercase leading-snug tracking-wide text-ink-100">
          Small steps.
          <br />
          Big understanding.
        </span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-ink-500 transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-ink-800/10 px-3.5 pb-3.5 pt-3">
              <p className="text-[12px] leading-relaxed text-ink-400">
                Point your camera at whatever you&apos;re working on, like a circuit, a
                notebook, or a lab setup, and I&apos;ll watch you work.
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
                You can also drop in a PDF and ask LENS about it.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => setView("camera")}
                  className="rounded-md border border-signal/40 bg-signal/10 px-3 py-1.5 text-[11.5px] font-semibold text-signal-deep transition hover:bg-signal/20"
                >
                  Open camera
                </button>
                <button
                  onClick={() => {
                    setView("sources");
                    setAddSourceOpen(true);
                  }}
                  className="rounded-md border border-ink-800/15 px-3 py-1.5 text-[11.5px] font-medium text-ink-200 transition hover:border-signal/30 hover:text-ink-100"
                >
                  Add a source
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
