"use client";

import { useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Bookmark, PanelLeft, Plus, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useLens } from "@/lib/store";
import { ThemeToggle } from "./ThemeToggle";
import { PersonaBadge } from "./PersonaBadge";
import { CircleDialog } from "./CircleDialog";

export function TopBar() {
  const { toggleSidebar, newSession, openStudyTool } = useLens();
  const [circlesOpen, setCirclesOpen] = useState(false);

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

      <div className="min-w-0 flex-1" />

      <button
        onClick={() => setCirclesOpen(true)}
        title="Study circles — invite friends"
        className="flex items-center gap-1.5 rounded-full border border-ink-800/15 bg-white/40 px-3.5 py-2 text-[12px] font-medium transition hover:border-signal/40 hover:bg-signal/10"
      >
        <Users className="size-3.5" />
        <span className="hidden sm:inline">Circles</span>
      </button>

      <button
        onClick={() => openStudyTool("library")}
        title="Everything you saved, and what you keep missing"
        className="flex items-center gap-1.5 rounded-full border border-ink-800/15 bg-white/40 px-3.5 py-2 text-[12px] font-medium transition hover:border-signal/40 hover:bg-signal/10"
      >
        <Bookmark className="size-3.5" />
        <span className="hidden sm:inline">Library</span>
      </button>

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

      {circlesOpen && <CircleDialog onClose={() => setCirclesOpen(false)} />}
    </header>
  );
}
