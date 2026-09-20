"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { PanelLeft, Plus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useLens } from "@/lib/store";
import { MetricsStrip } from "./MetricsStrip";
import { ThemeToggle } from "./ThemeToggle";
import { PersonaBadge } from "./PersonaBadge";

export function TopBar() {
  const { toggleSidebar, newSession } = useLens();

  return (
    <header className="mx-3 mt-3 flex h-[56px] shrink-0 items-center gap-3 rounded-full px-4 glass-raise">
      <button
        onClick={toggleSidebar}
        className="rounded-full p-2 text-ink-500 transition hover:bg-white/60 hover:text-ink-200"
        aria-label="Toggle sessions"
      >
        <PanelLeft className="size-4" />
      </button>

      <Link href="/" aria-label="LENS home" className="rounded-full">
        <Logo />
      </Link>

      <div className="hidden h-5 w-px bg-ink-800/15 md:block" />

      <span className="hidden text-[12px] text-ink-500 md:block">
        The tutor that never gives you the answer
      </span>

      <div className="min-w-0 flex-1">
        {/* Live, computed from the events collection. Visible all demo. */}
        <MetricsStrip />
      </div>

      <button
        onClick={newSession}
        className="flex items-center gap-1.5 rounded-full border border-ink-800/15 bg-white/40 px-3.5 py-2 text-[12px] font-medium transition hover:border-signal/40 hover:bg-signal/10"
      >
        <Plus className="size-3.5" />
        New session
      </button>

      <PersonaBadge />
      <ThemeToggle />

      <UserButton />
    </header>
  );
}
