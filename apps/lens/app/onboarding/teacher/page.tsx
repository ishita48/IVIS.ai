"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { ChipGroup } from "@/components/onboarding/ChipGroup";

const SUBJECTS = ["Computer Science", "Mathematics", "Physics", "Biology", "Data Science", "Other"];

const GOALS = [
  "Create a study session",
  "Share resources",
  "Collaborate on code",
  "Understand student progress",
];

const TOTAL_STEPS = 4;

export default function TeacherOnboarding() {
  const router = useRouter();
  const { teacher, setTeacher, completeTeacher } = useOnboarding();
  const [step, setStep] = useState(1);

  function toggle(list: string[], value: string) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function finish() {
    completeTeacher();
    router.push("/app/teacher");
  }

  const canContinue =
    step === 1 ? teacher.subjects.length > 0 :
    step === 2 ? teacher.className.trim().length > 0 :
    step === 3 ? teacher.goals.length > 0 :
    true;

  return (
    <OnboardingShell
      step={step}
      total={TOTAL_STEPS}
      title={
        step === 1 ? "What do you teach?" :
        step === 2 ? "Tell us about your class" :
        step === 3 ? "What would you like to do?" :
        "Your teaching workspace is ready."
      }
      subtitle={step === 1 ? "Pick everything that applies." : step === 3 ? "Pick as many as fit." : undefined}
      onBack={step > 1 ? () => setStep((s) => s - 1) : undefined}
      onNext={() => (step < TOTAL_STEPS ? setStep((s) => s + 1) : finish())}
      nextLabel={step < TOTAL_STEPS ? "Continue" : "Open Teacher Dashboard →"}
      nextDisabled={!canContinue}
      hideChrome={step === TOTAL_STEPS}
    >
      {step === 1 && (
        <ChipGroup
          options={SUBJECTS}
          selected={teacher.subjects}
          onToggle={(v) => setTeacher({ subjects: toggle(teacher.subjects, v) })}
        />
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block pl-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-500">
              Class name
            </label>
            <input
              value={teacher.className}
              onChange={(e) => setTeacher({ className: e.target.value })}
              placeholder="e.g. CS 111 — Intro to Programming"
              className="glass-input w-full rounded-xl p-3 text-[13.5px] font-medium"
            />
          </div>
          <div>
            <label className="mb-1.5 block pl-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-500">
              Subject
            </label>
            <select
              value={teacher.subject}
              onChange={(e) => setTeacher({ subject: e.target.value })}
              className="glass-input w-full appearance-none rounded-xl p-3 text-[13.5px] font-medium"
            >
              <option value="">Select a subject...</option>
              {teacher.subjects.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block pl-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-500">
              Description <span className="normal-case text-ink-500">(optional)</span>
            </label>
            <textarea
              value={teacher.description}
              onChange={(e) => setTeacher({ description: e.target.value })}
              placeholder="What's this class about?"
              className="glass-input h-20 w-full resize-none rounded-xl p-3 text-[13.5px] font-medium"
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <ChipGroup
          columns={2}
          options={GOALS}
          selected={teacher.goals}
          onToggle={(v) => setTeacher({ goals: toggle(teacher.goals, v) })}
        />
      )}

      {step === 4 && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-signal/12 text-signal-deep">
            <Sparkles className="size-6" />
          </div>
          <h2 className="text-[19px] font-bold text-ink-100">
            {teacher.className || "Your class"} is set up.
          </h2>
          <p className="max-w-sm text-[13.5px] leading-relaxed text-ink-400">
            You can create study sessions, share resources, and see where your students are
            getting stuck — all from your dashboard.
          </p>
          <button
            onClick={finish}
            className="mt-3 flex items-center gap-2 rounded-full bg-signal px-6 py-3 text-[14px] font-bold text-white shadow-glow transition hover:bg-signal-deep"
          >
            Open Teacher Dashboard →
          </button>
        </div>
      )}
    </OnboardingShell>
  );
}
