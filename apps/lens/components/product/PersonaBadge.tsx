"use client";

/**
 * PersonaBadge — sits next to the avatar. Shows which persona the current
 * session is in and lets you switch, since there's no backend role to
 * enforce this yet (see lib/persona.ts).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, GraduationCap, School } from "lucide-react";
import { usePersona, type Persona } from "@/lib/persona";
import { cn } from "@/lib/cn";

const COPY: Record<Persona, { label: string; icon: typeof GraduationCap }> = {
  student: { label: "Student", icon: GraduationCap },
  teacher: { label: "Teacher", icon: School },
};

export function PersonaBadge() {
  const { persona, setPersona } = usePersona();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!persona) return null;

  const Icon = COPY[persona].icon;
  const other: Persona = persona === "teacher" ? "student" : "teacher";
  const OtherIcon = COPY[other].icon;

  function switchTo(p: Persona) {
    setOpen(false);
    setPersona(p);
    router.push(p === "teacher" ? "/app/teacher" : "/app");
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-ink-800/15 bg-white/40 px-3 py-1.5 text-[12px] font-semibold text-ink-200 transition hover:border-signal/40"
      >
        <Icon className="size-3.5 text-signal-deep" />
        {COPY[persona].label}
        <ChevronDown className={cn("size-3 text-ink-500 transition", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-52 rounded-2xl border border-white/70 bg-white/95 p-1.5 shadow-lift backdrop-blur-xl">
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Switch view
            </div>
            <button
              onClick={() => switchTo(other)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-ink-200 transition hover:bg-signal/8"
            >
              <OtherIcon className="size-4 text-signal-deep" />
              {COPY[other].label} view
            </button>
          </div>
        </>
      )}
    </div>
  );
}
