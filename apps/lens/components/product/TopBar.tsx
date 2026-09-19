"use client";

import { UserButton } from "@clerk/nextjs";
import { PanelLeft, Plus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useLens } from "@/lib/store";
import { MetricsStrip } from "./MetricsStrip";

export function TopBar() {
  const { toggleSidebar, newSession } = useLens();

  return (
    <header className="flex h-[49px] shrink-0 items-center gap-3 border-b border-ink-800/10 px-3 glass-raise">
      <button
        onClick={toggleSidebar}
        className="rounded-lg p-1.5 text-ink-500 transition hover:bg-white/60 hover:text-ink-200"
        aria-label="Toggle sessions"
      >
        <PanelLeft className="size-4" />
      </button>

      <Logo />

      <span className="hidden text-[12px] text-ink-500 md:block">
        The tutor that never gives you the answer
      </span>

      <div className="min-w-0 flex-1">
        {/* Live, computed from the events collection. Visible all demo. */}
        <MetricsStrip />
      </div>

      <button
        onClick={newSession}
        className="flex items-center gap-1.5 rounded-full border border-ink-800/15 px-3 py-1.5 text-[12px] transition hover:border-signal/40 hover:bg-signal/5"
      >
        <Plus className="size-3.5" />
        New session
      </button>

      <UserButton />
    </header>
  );
}
