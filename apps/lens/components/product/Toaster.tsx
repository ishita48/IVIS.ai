"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { useLens } from "@/lib/store";

export function Toaster() {
  const { toasts, dismissToast } = useLens();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon =
            t.kind === "success"
              ? CheckCircle2
              : t.kind === "error"
              ? AlertCircle
              : Info;
          const color =
            t.kind === "success"
              ? "text-emerald-600 border-emerald-600/30"
              : t.kind === "error"
              ? "text-rose-500 border-rose-500/30"
              : "text-signal border-signal/30";
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8, x: 8 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              className={`pointer-events-auto flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-[12px] shadow-lift ${color}`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="text-ink-200">{t.text}</span>
              <button
                onClick={() => dismissToast(t.id)}
                className="ml-1 flex size-5 items-center justify-center rounded text-ink-500 hover:bg-ink-950/5"
              >
                <X className="size-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
