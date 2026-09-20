"use client";

/**
 * /join/[code] — the other end of an invite.
 *
 * The link a teacher copies (or that Resend mails) lands here. Clerk's
 * middleware sends a signed-out visitor to sign-in first and returns them,
 * so the code survives the round trip and the student never has to type it.
 *
 * Joining is idempotent: lib/classroom.ts reconciles an email invite with
 * the account that eventually claims it, so clicking the link twice — or
 * clicking it after already joining — does not add a second roster row.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function JoinPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = String(params?.code || "").toUpperCase();

  const [state, setState] = useState<"joining" | "joined" | "error">("joining");
  const [className, setClassName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = useCallback(async () => {
    setState("joining");
    try {
      const res = await fetch("/api/classes/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        class?: { name: string };
        error?: string;
      };
      if (!res.ok || !data.class) throw new Error(data.error || "Could not join.");
      setClassName(data.class.name);
      setState("joined");
      // Straight into the workspace — the class is context, not a place.
      setTimeout(() => router.push("/app"), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join.");
      setState("error");
    }
  }, [code, router]);

  useEffect(() => {
    if (code) void join();
  }, [code, join]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center app-canvas px-6">
      <div className="w-full max-w-md rounded-3xl glass-panel p-8 text-center">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>

        {state === "joining" && (
          <>
            <Loader2 className="mx-auto mb-4 size-6 animate-spin text-signal-deep" />
            <p className="text-[14px] text-ink-300">
              Joining class <span className="font-mono font-semibold">{code}</span>…
            </p>
          </>
        )}

        {state === "joined" && (
          <>
            <CheckCircle2 className="mx-auto mb-4 size-7 text-signal-deep" />
            <h1 className="text-[18px] font-semibold text-ink-100">
              You&apos;re in{className ? ` — ${className}` : ""}
            </h1>
            <p className="mt-2 text-[13px] text-ink-500">Opening your workspace…</p>
          </>
        )}

        {state === "error" && (
          <>
            <XCircle className="mx-auto mb-4 size-7 text-rose-500" />
            <h1 className="text-[16px] font-semibold text-ink-100">Couldn&apos;t join</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-500">{error}</p>
            <button
              onClick={() => void join()}
              className="mt-5 rounded-xl bg-signal px-4 py-2 text-[13px] font-semibold text-ink-950"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </main>
  );
}
