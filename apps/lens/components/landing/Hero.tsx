"use client";

/**
 * The headline reveals word-by-word on mount rather than fading in whole —
 * this is the first thing anyone sees, so it sets the pace for how the
 * rest of the page unfolds. "think" gets a hand-drawn underline that draws
 * itself in after the word lands.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { ProductPreview } from "./ProductPreview";

const LINE_ONE = ["Learning", "should", "help", "you"];
const LINE_TWO = ["not", "just", "give", "you", "the"];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

const word = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
};

export function Hero() {
  return (
    <section className="relative mx-auto w-full max-w-[1600px] px-6 pb-24 pt-20 sm:px-10 sm:pt-28">
      <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-signal/25 bg-signal/8 px-3.5 py-1.5 text-[12px] font-semibold text-signal-deep">
        HackMIT 2026 · Education
      </p>

      <motion.h1
        variants={container}
        initial="hidden"
        animate="show"
        className="max-w-5xl text-balance text-[12vw] font-extrabold leading-[1.04] tracking-tight text-ink-100 sm:text-[58px] lg:text-[76px]"
      >
        {LINE_ONE.map((w) => (
          <motion.span key={w} variants={word} className="mr-[0.26em] inline-block">
            {w}
          </motion.span>
        ))}
        <motion.span
          variants={word}
          className="relative mr-[0.26em] inline-block bg-gradient-to-r from-signal to-signal-deep bg-clip-text text-transparent"
        >
          think
          <motion.svg
            viewBox="0 0 130 16"
            className="absolute -bottom-2 left-0 h-3 w-[110%] text-signal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.0 }}
          >
            <motion.path
              d="M2 10c16-7 32-9 47-6.5s25 8 40 5.5 27-10 39-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.65, delay: 1.05, ease: "easeInOut" }}
            />
          </motion.svg>
        </motion.span>
        <motion.span variants={word} className="mr-[0.26em] inline-block">
          ,
        </motion.span>
        <br className="hidden sm:block" />
        {LINE_TWO.map((w) => (
          <motion.span key={w} variants={word} className="mr-[0.26em] inline-block">
            {w}
          </motion.span>
        ))}
        <motion.span
          variants={word}
          className="inline-block bg-gradient-to-r from-signal-deep to-signal bg-clip-text text-transparent"
        >
          answer
        </motion.span>
        <motion.span variants={word} className="inline-block">
          .
        </motion.span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.5 }}
        className="mt-7 max-w-xl text-pretty text-[16px] leading-relaxed text-ink-400"
      >
        LENS is an interactive learning environment that guides your reasoning, helps you
        understand your mistakes, and connects you with the people learning alongside you.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.65 }}
        className="mt-8 flex flex-wrap items-center gap-3"
      >
        <Link
          href="/app"
          className="flex items-center gap-2 rounded-full bg-signal px-6 py-3.5 text-[14.5px] font-bold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-signal-deep"
        >
          Start learning
          <ArrowRight className="size-4" />
        </Link>
        <a
          href="#how-it-works"
          className="flex items-center gap-1.5 px-4 py-3.5 text-[14.5px] font-semibold text-ink-100 transition hover:text-signal-deep"
        >
          See how LENS works
        </a>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 64 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.85, delay: 1.85, ease: [0.22, 1, 0.36, 1] }}
        className="mt-16 w-full"
      >
        <ProductPreview />
      </motion.div>
    </section>
  );
}
