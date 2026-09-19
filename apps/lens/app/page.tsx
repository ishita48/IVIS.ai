import Link from "next/link";
import { ArrowRight, Crosshair, GitBranch, ScanSearch } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function Landing() {
  return (
    <main className="min-h-screen app-canvas">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <div className="flex items-center gap-3 text-[13px]">
          <Link href="/sign-in" className="text-ink-400 transition hover:text-ink-100">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-full bg-signal px-4 py-2 font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white"
          >
            Try LENS
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-4xl px-6 pb-16 pt-14 text-center">
        <p className="mb-5 inline-block rounded-full border border-signal/30 bg-signal/10 px-3 py-1 text-[12px] font-medium text-signal-deep">
          HackMIT 2026 · Education
        </p>
        <h1 className="text-balance text-[44px] font-semibold leading-[1.08] tracking-tight text-ink-100 md:text-[58px]">
          The tutor that never gives you the answer.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-[17px] leading-relaxed text-ink-400">
          Every AI tutor sees the question. LENS sees the attempt — your screen,
          your workspace, what you predicted and what you retried — and
          reconstructs the exact point where your reasoning left the material.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/sign-up"
            className="flex items-center gap-2 rounded-full bg-signal px-5 py-3 text-[14px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white"
          >
            Point it at something
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-20 md:grid-cols-3">
        <Card
          icon={ScanSearch}
          title="LENS Vision"
          body="Point a camera at a circuit, a notebook, a lab bench. LENS narrates what it actually sees, points at the one thing that matters, and asks a question before it explains anything."
        />
        <Card
          icon={Crosshair}
          title="LENS Pointer"
          body="On screen, it finds the exact sentence, line, or control you should be looking at — pixel-accurate, using the tool built for coordinates rather than a model asked nicely for them."
        />
        <Card
          icon={GitBranch}
          title="LENS Reasoning"
          body="Every prediction and retry is recorded. The reasoning graph is rebuilt from those real events, so when LENS claims you believe something, it can show you why it thinks so."
        />
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24">
        <div className="rounded-3xl border border-ink-800/15 bg-white/50 p-8 backdrop-blur">
          <h2 className="mb-3 text-[20px] font-semibold text-ink-100">
            LENS escalates help. It doesn&apos;t dump solutions.
          </h2>
          <ol className="space-y-2 text-[14px] text-ink-400">
            {[
              ["L1", "Point — draw attention, say nothing about why"],
              ["L2", "Ask — a question you can answer from what's in front of you"],
              ["L3", "Nudge — one sentence that reframes"],
              ["L4", "Experiment — the smallest change that tests your belief"],
              ["L5", "Explain — only after you've actually tried"],
            ].map(([level, text]) => (
              <li key={level} className="flex gap-3">
                <span className="w-6 shrink-0 font-mono text-[12px] text-signal-deep">
                  {level}
                </span>
                {text}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="border-t border-ink-800/10 px-6 py-8 text-center text-[12px] text-ink-500">
        LENS · built on StudyO · HackMIT 2026
      </footer>
    </main>
  );
}

function Card({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="rounded-3xl border border-ink-800/15 bg-white/50 p-6 backdrop-blur">
      <Icon className="mb-3 size-6 text-signal-deep" />
      <h3 className="mb-2 text-[16px] font-semibold text-ink-100">{title}</h3>
      <p className="text-[13px] leading-relaxed text-ink-400">{body}</p>
    </div>
  );
}
