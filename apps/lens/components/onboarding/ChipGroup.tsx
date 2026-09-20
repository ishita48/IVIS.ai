"use client";

import { cn } from "@/lib/cn";

export function ChipGroup({
  options,
  selected,
  onToggle,
  columns = 3,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  columns?: 2 | 3;
}) {
  return (
    <div className={cn("grid gap-2.5", columns === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={cn(
              "rounded-xl border px-3.5 py-3 text-left text-[13px] font-semibold transition",
              active
                ? "border-signal bg-signal/10 text-signal-deep shadow-card"
                : "border-white/70 bg-white/45 text-ink-200 hover:border-signal/30 hover:bg-white/65"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function CardGroup({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; title: string; body: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onToggle(opt.value)}
            className={cn(
              "rounded-2xl border px-4 py-3.5 text-left transition",
              active
                ? "border-signal bg-signal/10 shadow-card"
                : "border-white/70 bg-white/45 hover:border-signal/30 hover:bg-white/65"
            )}
          >
            <div className={cn("text-[13.5px] font-bold", active ? "text-signal-deep" : "text-ink-100")}>
              {opt.title}
            </div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-ink-400">{opt.body}</div>
          </button>
        );
      })}
    </div>
  );
}
