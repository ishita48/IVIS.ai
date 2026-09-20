"use client";

/**
 * RoleSelection — first thing a signed-in user with no saved persona sees.
 * Picking a card sets the persona (lib/persona.ts) and, after a short
 * confirm animation, hands off to the matching onboarding wizard.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, GraduationCap, School, Sparkles } from "lucide-react";
import { usePersona, type Persona } from "@/lib/persona";
import { SkipOnboarding } from "@/components/onboarding/SkipOnboarding";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/cn";

const CARDS: {
  id: Persona;
  icon: typeof GraduationCap;
  title: string;
  tagline: string;
  features: string[];
  cta: string;
}[] = [
  {
    id: "student",
    icon: GraduationCap,
    title: "Student",
    tagline: "Learn by thinking, practicing, and studying together.",
    features: ["Guided learning", "AI hints", "Collaborative study", "Coding sessions"],
    cta: "I'm a Student",
  },
  {
    id: "teacher",
    icon: School,
    title: "Teacher",
    tagline: "Create meaningful learning experiences for your students.",
    features: ["Create classes", "Share resources", "Study sessions", "Student insights"],
    cta: "I'm a Teacher",
  },
];

export function RoleSelection() {
  const setPersona = usePersona((s) => s.setPersona);
  const router = useRouter();
  const [picked, setPicked] = useState<Persona | null>(null);

  function choose(p: Persona) {
    if (picked) return;
    setPicked(p);
    setPersona(p);
    setTimeout(() => router.push(`/onboarding/${p}`), 420);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center app-canvas px-4 py-16">
      <div className="mb-9 flex flex-col items-center gap-4 text-center">
        <Logo />
        <h1 className="text-[30px] font-extrabold tracking-tight text-ink-100 sm:text-[36px]">
          Welcome to LENS
        </h1>
        <p className="text-[15px] text-ink-400">How will you be using LENS?</p>
      </div>

      <div className="grid w-full max-w-3xl gap-5 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const selected = picked === card.id;
          const dimmed = picked !== null && !selected;
          return (
            <button
              key={card.id}
              onClick={() => choose(card.id)}
              disabled={picked !== null}
              className={cn(
                "group relative flex flex-col items-start gap-5 rounded-3xl border p-7 text-left transition-all duration-300",
                selected
                  ? "border-signal bg-signal/8 shadow-glow scale-[1.02]"
                  : "border-white/70 bg-white/50 hover:-translate-y-1 hover:border-signal/40 hover:shadow-lift",
                dimmed && "opacity-40 scale-[0.98]"
              )}
            >
              {selected && (
                <span className="absolute right-5 top-5 flex size-6 items-center justify-center rounded-full bg-signal text-white">
                  <Check className="size-3.5" />
                </span>
              )}
              <div className="flex size-12 items-center justify-center rounded-2xl bg-signal/12 text-signal-deep transition group-hover:bg-signal/20">
                <Icon className="size-6" />
              </div>
              <div>
                <h2 className="text-[19px] font-bold text-ink-100">{card.title}</h2>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-400">{card.tagline}</p>
              </div>
              <ul className="flex flex-col gap-2">
                {card.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-[13px] font-medium text-ink-200">
                    <Check className="size-3.5 shrink-0 text-signal-deep" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex items-center gap-1.5 text-[13.5px] font-bold text-signal-deep">
                {card.cta} <span aria-hidden>→</span>
              </div>
            </button>
          );
        })}
      </div>

      <SkipOnboarding disabled={picked !== null} />

      <p className="mt-8 flex items-center gap-1.5 text-[12px] text-ink-500">
        <Sparkles className="size-3.5" />
        You can switch anytime from your profile menu.
      </p>
    </div>
  );
}
