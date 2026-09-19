"use client";

/**
 * PointerOverlay — the "look here" layer, shared by both pointer modes.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 1.
 *
 * Camera mode draws a normalized bounding box that came back in the SAME
 * vision response as the observation — no second model call, which keeps
 * camera-mode latency to one round trip.
 *
 * Screen mode draws a bubble at a point returned by Computer Use.
 *
 * Both take normalized 0-1 coordinates and scale by the rendered element
 * size, so the overlay stays correct through window resizes and object-fit
 * letterboxing without recomputing anything server-side.
 */

import { motion } from "framer-motion";
import type { BoundingBox, PointerTarget } from "@/lib/lens/contracts";

export function BoxOverlay({
  box,
  label,
  confidence,
}: {
  box: BoundingBox | null;
  label?: string | null;
  confidence?: number;
}) {
  if (!box) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className="pointer-events-none absolute"
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
      }}
    >
      <div className="absolute inset-0 rounded-lg border-2 border-signal shadow-[0_0_0_9999px_rgba(8,10,20,0.35)]" />
      <div className="absolute inset-0 animate-pulse rounded-lg border border-signal/60" />
      {label && (
        <div className="absolute -top-7 left-0 whitespace-nowrap rounded-full bg-signal px-2.5 py-1 text-[11px] font-medium text-ink-950">
          {label}
          {typeof confidence === "number" && (
            <span className="ml-1.5 opacity-70">
              {Math.round(confidence * 100)}% likely
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

export function BubbleOverlay({ target }: { target: PointerTarget | null }) {
  if (!target) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
      style={{ left: `${target.nx * 100}%`, top: `${target.ny * 100}%` }}
    >
      <div className="mb-1 rounded-full bg-signal px-3 py-1.5 text-[12px] font-medium text-ink-950 shadow-lift">
        {target.label}
      </div>
      <div className="mx-auto size-3 rounded-full bg-signal ring-4 ring-signal/25" />
    </motion.div>
  );
}
