"use client";

import { useRouter } from "next/navigation";
import { useOnboarding } from "@/lib/onboarding";

export function SkipOnboarding({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const skip = useOnboarding((s) => s.skip);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        skip();
        router.replace("/app");
      }}
      className="mt-6 rounded-full px-4 py-2 text-[13px] font-semibold text-ink-400 transition hover:bg-white/50 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Skip for now
    </button>
  );
}
