"use client";

/**
 * /live — LENS as a spoken tutor.
 *
 * ConversationProvider must wrap anything calling useConversation(), which is
 * why it sits here rather than inside useAgent.
 */

import { useEffect, useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { CameraView } from "@/components/Camera/CameraView";
import { Logo } from "@/components/Logo";

export default function LivePage() {
  // Dark by default: this page is mostly a camera feed, and a video panel on
  // white reads as a hole in the page. Demo rooms are dark too.
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("lens-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      /* private mode — the default is fine */
    }
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("lens-theme", next);
    } catch {
      /* not worth failing over */
    }
  };

  return (
    <main data-theme={theme} className="min-h-screen app-canvas">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        <Logo invert={theme === "dark"} />
        <div className="flex items-center gap-3">
          <p className="hidden text-[13px] text-ink-500 sm:block">
            Talk to it. It looks only when it needs to.
          </p>
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="rounded-full glass-chip px-3 py-1.5 text-[12px] text-ink-400 transition hover:text-ink-100"
          >
            {theme === "dark" ? "light" : "dark"}
          </button>
        </div>
      </header>

      <ConversationProvider>
        <CameraView />
      </ConversationProvider>
    </main>
  );
}
