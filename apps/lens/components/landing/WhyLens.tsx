"use client";

/**
 * The comparison that sets up the whole product: most tools answer, LENS
 * asks. Scroll physically pushes the old way aside instead of stacking it
 * next to LENS in equal-weight cards — the point is that they don't get
 * equal weight.
 */

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

export function WhyLens() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start 0.85", "end 0.25"] });

  const oldX = useTransform(scrollYProgress, [0, 1], ["0%", "-14%"]);
  const oldOpacity = useTransform(scrollYProgress, [0, 0.6, 1], [1, 0.5, 0.22]);
  const lensX = useTransform(scrollYProgress, [0, 1], ["0%", "3%"]);
  const lensScale = useTransform(scrollYProgress, [0, 1], [1, 1.06]);

  return (
    <section id="why" ref={sectionRef} className="mx-auto w-full max-w-[1600px] px-6 py-28 sm:px-10 lg:py-36">
      <motion.div style={{ x: oldX, opacity: oldOpacity }} className="border-b border-ink-800/15 pb-10 sm:pb-14">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-ink-500">Most AI tools</p>
        <p className="mt-4 text-balance text-[12vw] font-extrabold leading-[0.96] tracking-tight text-ink-400 sm:text-[7vw] lg:text-[84px]">
          &ldquo;What&rsquo;s the answer?&rdquo;
        </p>
      </motion.div>

      <motion.div style={{ x: lensX, scale: lensScale }} className="origin-left pt-10 sm:pt-14">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-signal-deep">LENS</p>
        <p className="mt-4 text-balance text-[12vw] font-extrabold leading-[0.96] tracking-tight text-ink-100 sm:text-[7vw] lg:text-[84px]">
          &ldquo;What do you notice?&rdquo;
        </p>
      </motion.div>
    </section>
  );
}
