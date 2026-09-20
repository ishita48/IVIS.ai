import { Check } from "lucide-react";

const CAPABILITIES = [
  "Create classes",
  "Share resources",
  "Create study sessions",
  "Share code",
  "Create coding challenges",
  "Monitor participation",
  "Identify common areas of confusion",
];

export function TeacherSection() {
  return (
    <section id="teachers" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-[30px] font-extrabold tracking-tight text-ink-100 sm:text-[36px]">
            For teachers, too.
          </h2>
          <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-ink-400">
            LENS isn't only a student tool. Set up a class, watch understanding in real time, and
            get students the right kind of help before they get stuck for good.
          </p>
          <ul className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <li key={c} className="flex items-center gap-2 text-[13px] font-medium text-ink-200">
                <Check className="size-3.5 shrink-0 text-signal-deep" />
                {c}
              </li>
            ))}
          </ul>
        </div>

        {/* Compact dashboard preview */}
        <div className="rounded-[28px] border border-white/70 bg-white/55 p-5 shadow-lift backdrop-blur-xl">
          <div className="mb-4 text-[10.5px] font-bold uppercase tracking-wider text-ink-500">Today</div>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              ["32", "students active"],
              ["4", "study sessions"],
              ["18", "questions asked"],
            ].map(([n, label]) => (
              <div key={label} className="rounded-xl border border-white/60 bg-white/50 p-3 text-center">
                <div className="text-[20px] font-extrabold text-signal-deep">{n}</div>
                <div className="mt-0.5 text-[10.5px] leading-tight text-ink-500">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2.5">
            <div className="rounded-xl border border-white/60 bg-white/50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Most discussed</div>
              <div className="mt-1 text-[13px] font-semibold text-ink-100">Python Functions</div>
            </div>
            <div className="rounded-xl border border-signal/25 bg-signal/8 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-signal-deep">Common difficulty</div>
              <div className="mt-1 text-[13px] font-semibold text-ink-100">Return values</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
