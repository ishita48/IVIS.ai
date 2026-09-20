"use client";

/**
 * The whole last viewport is the CTA — no card around it. The lens mark
 * drifts a few pixels toward the cursor, the one place on the page that
 * responds to the pointer rather than the scroll.
 */

import { useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { TeacherEntryButton } from "./TeacherEntryButton";

export function FinalCta() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 60, damping: 16 });
  const y = useSpring(my, { stiffness: 60, damping: 16 });

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = e.clientX - rect.left - rect.width / 2;
    const relY = e.clientY - rect.top - rect.height / 2;
    mx.set(relX * 0.04);
    my.set(relY * 0.04);
  }

  function onMouseLeave() {
    mx.set(0);
    my.set(0);
  }

  return (
    <section
      ref={wrapRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-6 py-24 text-center sm:px-10"
    >
      <motion.svg
        aria-hidden
        viewBox="0 0 32 32"
        style={{ x, y }}
        className="pointer-events-none absolute size-[52vw] max-w-[560px] text-signal/[0.08] sm:size-[40vw]"
      >
        <path d="M3,16 A13,13 0 0,0 29,16 A13,13 0 0,0 3,16 Z" fill="currentColor" />
      </motion.svg>

      <p className="relative text-[11px] font-bold uppercase tracking-[0.25em] text-ink-500">
        Point. Think. Discover.
      </p>

      <h2 className="relative mt-5 max-w-4xl text-balance text-[11vw] font-extrabold leading-[1.03] tracking-tight text-ink-100 sm:text-[56px] lg:text-[64px]">
        See what learning with LENS feels like.
      </h2>

      <div className="relative mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/app"
          className="flex items-center gap-2 rounded-full bg-signal px-7 py-4 text-[15px] font-bold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-signal-deep"
        >
          Open LENS
          <ArrowRight className="size-4" />
        </Link>
        <TeacherEntryButton className="px-5 py-4 text-[15px] font-semibold text-ink-100 transition hover:text-signal-deep">
          Explore for teachers
        </TeacherEntryButton>
      </div>

      <p className="relative mt-20 text-[12.5px] italic text-ink-500">
        The best answer is the one you figured out yourself.
      </p>
    </section>
  );
}
