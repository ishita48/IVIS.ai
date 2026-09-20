"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { SkipOnboarding } from "./SkipOnboarding";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/cn";

export function OnboardingShell({
  step,
  total,
  title,
  subtitle,
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
  hideChrome,
  children,
}: {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  hideChrome?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center app-canvas px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>

      <div className="w-full max-w-xl rounded-3xl glass-panel p-7 sm:p-9">
        {!hideChrome && (
          <div className="mb-6 flex items-center gap-3">
            <span className="text-[12px] font-bold tracking-wide text-signal-deep">
              {String(step).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/50">
              <motion.div
                className="h-full rounded-full bg-signal"
                initial={false}
                animate={{ width: `${(step / total) * 100}%` }}
                transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              />
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <h1 className="text-[22px] font-extrabold tracking-tight text-ink-100">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[13.5px] text-ink-400">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </motion.div>
        </AnimatePresence>

        {!hideChrome && (
          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={onBack}
              disabled={!onBack}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold text-ink-400 transition",
                onBack ? "hover:bg-white/50 hover:text-ink-100" : "opacity-0"
              )}
            >
              <ArrowLeft className="size-3.5" />
              Back
            </button>
            <button
              onClick={onNext}
              disabled={nextDisabled}
              className="flex items-center gap-1.5 rounded-full bg-signal px-5 py-2.5 text-[13.5px] font-bold text-white shadow-glow transition hover:bg-signal-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              {nextLabel}
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      <SkipOnboarding />
    </div>
  );
}
