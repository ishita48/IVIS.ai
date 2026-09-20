"use client";

/**
 * PersonaGate — wraps everything under /app.
 * ─────────────────────────────────────────────────────────────────────
 *  no persona saved        → show RoleSelection (blocks)
 *  persona set, onboarding
 *  not finished for it     → redirect to /onboarding/<persona>
 *  otherwise               → render children (the real dashboard)
 *
 * Switching persona later happens through PersonaBadge, not here — this
 * gate only handles the very first landing after sign-in.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePersona } from "@/lib/persona";
import { useOnboarding } from "@/lib/onboarding";
import { RoleSelection } from "@/components/product/RoleSelection";

export function PersonaGate({ children }: { children: React.ReactNode }) {
  const { persona, hydrated: personaHydrated, hydrate: hydratePersona } = usePersona();
  const {
    hydrated: onboardingHydrated,
    studentComplete,
    teacherComplete,
    hydrate: hydrateOnboarding,
  } = useOnboarding();
  const router = useRouter();

  useEffect(() => {
    hydratePersona();
    hydrateOnboarding();
  }, [hydratePersona, hydrateOnboarding]);

  const hydrated = personaHydrated && onboardingHydrated;
  const onboardingDone = persona === "teacher" ? teacherComplete : studentComplete;

  useEffect(() => {
    if (!hydrated || !persona || onboardingDone) return;
    router.replace(`/onboarding/${persona}`);
  }, [hydrated, persona, onboardingDone, router]);

  if (!hydrated) {
    return <div className="min-h-screen app-canvas" />;
  }

  if (persona === null) {
    return <RoleSelection />;
  }

  if (!onboardingDone) {
    return <div className="min-h-screen app-canvas" />;
  }

  return <>{children}</>;
}
