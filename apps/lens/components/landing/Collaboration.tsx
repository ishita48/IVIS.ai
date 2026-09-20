import { Play, Users2 } from "lucide-react";

const MESSAGES = [
  { name: "Maya", color: "bg-signal", text: "Why does this return None?" },
  { name: "Alex", color: "bg-signal-soft", text: "Look at line 12 👀" },
  { name: "LENS", color: "bg-ink-100", text: "Before checking the answer — what does the function return?" },
];

export function Collaboration() {
  return (
    <section id="collaboration" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
      <div className="mx-auto mb-12 max-w-xl text-center">
        <h2 className="text-[30px] font-extrabold tracking-tight text-ink-100 sm:text-[38px]">
          Learning is better together.
        </h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-400">
          LENS isn't just a one-on-one tutor. Join a study session and work through the same
          problem alongside people learning it right now.
        </p>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/55 shadow-lift backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/50 px-5 py-3.5">
          <div>
            <div className="text-[13.5px] font-bold text-ink-100">Python Functions</div>
            <div className="text-[11.5px] text-ink-500">Study session</div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11.5px] font-semibold text-emerald-600">
            <Users2 className="size-3.5" />
            8 students studying
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr_1fr]">
          {/* Left — session info */}
          <div className="flex flex-col gap-2.5 border-b border-white/50 p-5 lg:border-b-0 lg:border-r">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">In this session</div>
            {["Maya", "Alex", "Priya", "Jordan", "+4 more"].map((n) => (
              <div key={n} className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-full bg-signal/15 text-[10.5px] font-bold text-signal-deep">
                  {n[0]}
                </span>
                <span className="text-[12.5px] font-medium text-ink-200">{n}</span>
              </div>
            ))}
          </div>

          {/* Center — shared editor */}
          <div className="border-b border-white/50 p-5 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-ink-500">
              Shared editor
              <span className="flex items-center gap-1 text-signal-deep">
                <Play className="size-3" /> run
              </span>
            </div>
            <div className="mt-2.5 rounded-xl bg-ink-100/90 p-4 font-mono text-[11.5px] leading-relaxed text-ink-900">
              <div><span className="text-signal-soft">def</span> total(nums):</div>
              <div className="pl-4">result = 0</div>
              <div className="pl-4">for n in nums:</div>
              <div className="pl-8">result += n</div>
              <div className="pl-4 text-ink-500"># missing return?</div>
            </div>
          </div>

          {/* Right — discussion */}
          <div className="flex flex-col gap-3 p-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Discussion</div>
            {MESSAGES.map((m) => (
              <div key={m.name} className="flex items-start gap-2.5">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold text-white ${m.color}`}>
                  {m.name[0]}
                </span>
                <div>
                  <div className="text-[11px] font-bold text-ink-200">{m.name}</div>
                  <div className="text-[12px] leading-relaxed text-ink-400">{m.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
