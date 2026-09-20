"use client";

/**
 * FocusChip — a small square that says whether you are still here.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Off by default and toggled from the camera controls, because a tutor
 * that starts watching whether you are paying attention without being
 * asked is a different and much less pleasant product.
 *
 * WHEN FOCUSED IT IS A DOT, not a message. A green "you are concentrating
 * well!" badge is noise at best, and at worst it is the thing that breaks
 * concentration. It only earns words when the answer changes.
 *
 * It never blocks, never plays a sound and never pauses anything. Coming
 * back to a lecture that stopped when you looked away is worse than
 * missing ten seconds of it — and the student may have looked away
 * precisely to read the datasheet the tutor told them to read.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Moon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Attention } from "@/hooks/useFocusWatch";

const LOOK: Record<
  Attention,
  { icon: typeof Eye; label: string; tone: string; emoji: string }
> = {
  focused: {
    icon: Eye,
    label: "with it",
    tone: "bg-emerald-50/90 text-emerald-700",
    emoji: "👀",
  },
  idle: {
    icon: Moon,
    label: "still there?",
    tone: "bg-amber-50/90 text-amber-800",
    emoji: "💤",
  },
  away: {
    icon: EyeOff,
    label: "looking away",
    tone: "bg-rose-50/90 text-rose-700",
    emoji: "🚶",
  },
};

function ago(since: number | null): string {
  if (!since) return "";
  const s = Math.round((Date.now() - since) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

export function FocusChip({
  attention,
  since,
}: {
  attention: Attention;
  since: number | null;
}) {
  // Re-render once a second only while the counter is actually showing.
  const [, tick] = useState(0);
  useEffect(() => {
    if (attention === "focused") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [attention]);

  const look = LOOK[attention];
  const Icon = look.icon;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={attention}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] font-semibold backdrop-blur",
            look.tone,
            // Focused is a square the size of a dot; the others earn room.
            attention === "focused" && "px-1.5"
          )}
        >
          <Icon className="size-3.5 shrink-0" />
          {attention !== "focused" && (
            <>
              <span>{look.label}</span>
              {since && <span className="font-mono opacity-60">{ago(since)}</span>}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
