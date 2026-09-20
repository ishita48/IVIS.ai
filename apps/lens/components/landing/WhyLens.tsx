import { BrainCircuit, Camera, Users2, LineChart } from "lucide-react";

const CARDS = [
  {
    icon: BrainCircuit,
    title: "Think, don't copy",
    body: "LENS guides students through reasoning instead of immediately revealing the solution.",
  },
  {
    icon: Camera,
    title: "Learn from your work",
    body: "Use your camera, notes, diagrams, and code as part of the learning process.",
  },
  {
    icon: Users2,
    title: "Learn together",
    body: "Join study sessions with students learning the same topic.",
  },
  {
    icon: LineChart,
    title: "Teachers see the bigger picture",
    body: "Teachers can create sessions, share resources, and understand where students need help.",
  },
];

export function WhyLens() {
  return (
    <section id="why" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-balance text-[30px] font-extrabold leading-tight tracking-tight text-ink-100 sm:text-[38px]">
          Most AI tools give you the answer.
          <br />
          LENS helps you find it.
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.title}
              className="rounded-2xl border border-white/70 bg-white/50 p-6 shadow-card transition hover:-translate-y-1 hover:shadow-lift"
            >
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-signal/12 text-signal-deep">
                <Icon className="size-5" />
              </div>
              <h3 className="mb-2 text-[14.5px] font-bold text-ink-100">{c.title}</h3>
              <p className="text-[13px] leading-relaxed text-ink-400">{c.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
