import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TeacherEntryButton } from "./TeacherEntryButton";

export function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-4xl px-4 pb-24 pt-4 sm:px-6">
      <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-gradient-to-br from-signal/12 via-white/50 to-[#F56565]/10 p-10 text-center shadow-lift sm:p-14">
        <div className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full bg-signal/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -right-16 size-64 rounded-full bg-[#F56565]/25 blur-3xl" />

        <h2 className="relative text-balance text-[28px] font-extrabold tracking-tight text-ink-100 sm:text-[34px]">
          See what learning with LENS feels like.
        </h2>

        <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/app"
            className="flex items-center gap-2 rounded-full bg-signal px-6 py-3.5 text-[14.5px] font-bold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-signal-deep"
          >
            Open LENS
            <ArrowRight className="size-4" />
          </Link>
          <TeacherEntryButton className="px-4 py-3.5 text-[14.5px] font-semibold text-ink-100 transition hover:text-signal-deep">
            Explore for teachers
          </TeacherEntryButton>
        </div>
      </div>
    </section>
  );
}
