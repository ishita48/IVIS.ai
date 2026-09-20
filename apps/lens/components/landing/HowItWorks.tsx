import { Camera, MessageCircleQuestion, Users2 } from "lucide-react";

const STEPS = [
  {
    n: "01",
    icon: Camera,
    title: "Show LENS what you're working on",
    body: "Camera, notes, code, diagrams, PDFs — whatever you're actually stuck on.",
  },
  {
    n: "02",
    icon: MessageCircleQuestion,
    title: "LENS helps you reason",
    body: "LENS observes your work and gives questions, hints, and guidance instead of simply solving the problem.",
  },
  {
    n: "03",
    icon: Users2,
    title: "Understand it together",
    body: "Study with classmates, collaborate on code, and learn through shared study sessions.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
      <div className="mx-auto mb-14 max-w-xl text-center">
        <h2 className="text-[30px] font-extrabold tracking-tight text-ink-100 sm:text-[38px]">
          How LENS works
        </h2>
      </div>

      <div className="relative grid gap-8 sm:grid-cols-3">
        <div className="absolute inset-x-[12%] top-8 hidden h-px bg-gradient-to-r from-transparent via-signal/30 to-transparent sm:block" />
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.n} className="relative flex flex-col items-center text-center">
              <div className="relative mb-5 flex size-16 items-center justify-center rounded-2xl border border-white/70 bg-white/60 shadow-lift">
                <Icon className="size-6 text-signal-deep" />
                <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-signal text-[10px] font-bold text-white">
                  {s.n}
                </span>
              </div>
              <h3 className="mb-2 text-[15px] font-bold text-ink-100">{s.title}</h3>
              <p className="max-w-[260px] text-[13px] leading-relaxed text-ink-400">{s.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
