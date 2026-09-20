"use client";

/**
 * "Explore for teachers" — pre-sets the persona so PersonaGate routes
 * straight into the teacher onboarding/dashboard instead of showing the
 * role-selection screen again.
 */

import { useRouter } from "next/navigation";
import { usePersona } from "@/lib/persona";

export function TeacherEntryButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const setPersona = usePersona((s) => s.setPersona);
  const router = useRouter();

  return (
    <button
      onClick={() => {
        setPersona("teacher");
        router.push("/app/teacher");
      }}
      className={className}
    >
      {children}
    </button>
  );
}
