import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProductPreview } from "./ProductPreview";

export function Hero() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 pb-20 pt-14 text-center sm:px-6 sm:pt-20">
      <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-signal/25 bg-signal/8 px-3.5 py-1.5 text-[12px] font-semibold text-signal-deep">
        HackMIT 2026 · Education
      </p>
      <h1 className="text-balance text-[38px] font-extrabold leading-[1.1] tracking-tight text-ink-100 sm:text-[52px]">
        Learning should help you{" "}
        <span className="bg-gradient-to-r from-signal via-[#F6AD55] to-[#F56565] bg-clip-text text-transparent">
          think
        </span>
        ,<br className="hidden sm:block" /> not just give you the{" "}
        <span className="bg-gradient-to-r from-[#F56565] via-[#F6AD55] to-signal bg-clip-text text-transparent">
          answer
        </span>
        .
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-pretty text-[15.5px] leading-relaxed text-ink-400">
        LENS is an interactive learning environment that guides your reasoning, helps you understand
        your mistakes, and connects you with the people learning alongside you.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
      </div>

      <div className="mt-16 w-full">
        <ProductPreview />
      </div>
    </section>
  );
}
