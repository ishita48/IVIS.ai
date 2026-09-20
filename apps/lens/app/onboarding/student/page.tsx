"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { ChipGroup, CardGroup } from "@/components/onboarding/ChipGroup";

const SUBJECTS = ["Computer Science", "Mathematics", "Physics", "Biology", "Data Science", "Other"];

const STYLES = [
  { value: "Visual", title: "Visual", body: "I learn best by seeing it." },
  { value: "Hands-on", title: "Hands-on", body: "I learn by trying it myself." },
  { value: "Step-by-step", title: "Step-by-step", body: "I like structured explanations." },
  { value: "Discussion", title: "Discussion", body: "I understand better when I talk it through." },
];

const GOALS = ["Upcoming exam", "Homework", "Project", "Interview", "Personal learning", "Just exploring"];

const TOTAL_STEPS = 4;

export default function StudentOnboarding() {
  const router = useRouter();
  const { student, setStudent, completeStudent } = useOnboarding();
  const [step, setStep] = useState(1);

  function toggle(list: string[], value: string) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function finish() {
    completeStudent();
    router.push("/app");
  }

  const canContinue =
    step === 1 ? student.subjects.length > 0 :
    step === 2 ? student.styles.length > 0 :
    step === 3 ? !!student.goal :
    true;

  return (
    <OnboardingShell
      step={step}
      total={TOTAL_STEPS}
      title={
        step === 1 ? "What are you learning?" :
        step === 2 ? "How do you like to learn?" :
        step === 3 ? "What are you working toward?" :
        "You're ready."
      }
      subtitle={step === 1 ? "Pick everything that applies." : step === 2 ? "Pick as many as fit." : undefined}
      onBack={step > 1 ? () => setStep((s) => s - 1) : undefined}
      onNext={() => (step < TOTAL_STEPS ? setStep((s) => s + 1) : finish())}
      nextLabel={step < TOTAL_STEPS ? "Continue" : "Enter LENS →"}
      nextDisabled={!canContinue}
      hideChrome={step === TOTAL_STEPS}
    >
      {step === 1 && (
        <ChipGroup
          options={SUBJECTS}
          selected={student.subjects}
          onToggle={(v) => setStudent({ subjects: toggle(student.subjects, v) })}
        />
      )}

      {step === 2 && (
        <CardGroup
          options={STYLES}
          selected={student.styles}
          onToggle={(v) => setStudent({ styles: toggle(student.styles, v) })}
        />
      )}

      {step === 3 && (
        <ChipGroup
          options={GOALS}
          selected={student.goal ? [student.goal] : []}
          onToggle={(v) => setStudent({ goal: student.goal === v ? null : v })}
        />
      )}

      {step === 4 && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-signal/12 text-signal-deep">
            <Sparkles className="size-6" />
          </div>
          <h2 className="text-[19px] font-bold text-ink-100">Your LENS is ready.</h2>
          <p className="max-w-sm text-[13.5px] leading-relaxed text-ink-400">
            LENS will guide you based on how you learn. Remember — we won't just give you the answer.
          </p>
          <button
            onClick={finish}
            className="mt-3 flex items-center gap-2 rounded-full bg-signal px-6 py-3 text-[14px] font-bold text-white shadow-glow transition hover:bg-signal-deep"
          >
            Enter LENS →
          </button>
        </div>
      )}
    </OnboardingShell>
  );
}
