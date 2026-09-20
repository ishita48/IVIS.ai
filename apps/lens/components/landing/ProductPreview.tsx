import { Camera, Crosshair, GitBranch, Layers, Lightbulb, MessageSquare, Sparkles } from "lucide-react";

const TABS = [
  { icon: Camera, label: "Camera", active: true },
  { icon: Crosshair, label: "Pointer", active: false },
  { icon: GitBranch, label: "Reasoning", active: false },
  { icon: Layers, label: "Sources", active: false },
];

const SESSIONS = [
  { label: "Circuits — Physics", color: "bg-signal" },
  { label: "Derivatives — Calc", color: "bg-signal-soft" },
  { label: "Recursion — CS", color: "bg-signal-deep" },
];

/**
 * A stylized, non-literal recreation of the LENS workspace for the landing
 * page — same structure (sessions, mode tabs, observation panel, prompt
 * bar) as the real app, but decorative placeholder content rather than a
 * pixel screenshot.
 */
export function ProductPreview() {
  return (
    <div className="relative rounded-[28px] border border-white/70 bg-white/55 p-3 shadow-lift backdrop-blur-xl sm:p-4">
      <div className="flex items-center gap-1.5 px-2 pb-3">
        <span className="size-2.5 rounded-full bg-rose-300" />
        <span className="size-2.5 rounded-full bg-amber-300" />
        <span className="size-2.5 rounded-full bg-emerald-300" />
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* Sessions rail */}
        <div className="col-span-3 hidden flex-col gap-2 sm:flex">
          {SESSIONS.map((s) => (
            <div key={s.label} className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/50 p-2.5">
              <span className={`size-6 shrink-0 rounded-lg ${s.color}`} />
              <span className="truncate text-[11px] font-semibold text-ink-200">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Main workspace */}
        <div className="col-span-12 flex flex-col gap-3 sm:col-span-6">
          <div className="flex items-center gap-1 rounded-full border border-white/60 bg-white/50 p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <span
                  key={t.label}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                    t.active ? "bg-signal text-white shadow-card" : "text-ink-500"
                  }`}
                >
                  <Icon className="size-3" />
                  <span className="hidden md:inline">{t.label}</span>
                </span>
              );
            })}
          </div>
          <div className="flex min-h-[160px] flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-white/50 bg-gradient-to-br from-signal/12 via-white/30 to-signal-soft/20 p-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-signal text-white shadow-glow">
              <Camera className="size-5" />
            </span>
            <p className="text-[12.5px] font-semibold text-ink-200">Show LENS your work</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/60 bg-white/60 px-3.5 py-2.5">
            <MessageSquare className="size-3.5 text-ink-500" />
            <span className="text-[11.5px] text-ink-500">Ask about what you're stuck on...</span>
          </div>
        </div>

        {/* Observation panel */}
        <div className="col-span-12 flex flex-col gap-2.5 sm:col-span-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-signal-deep">
            <Sparkles className="size-3" />
            Observation
          </div>
          <div className="rounded-xl border border-white/60 bg-white/50 p-2.5 text-[11px] leading-relaxed text-ink-300">
            A diagram with a loop and a counter that never gets reset.
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-signal/25 bg-signal/8 p-2.5">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-signal-deep" />
            <span className="text-[11px] leading-relaxed text-ink-300">
              What happens to that counter on the second pass?
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
