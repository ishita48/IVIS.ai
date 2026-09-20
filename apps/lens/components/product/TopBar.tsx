"use client";

/**
 * TopBar — navigation only.
 * ─────────────────────────────────────────────────────────────────────
 * Left: sessions toggle and the LENS mark, which is the home affordance —
 * it always lands on /app in Camera view, never on the marketing page.
 * Centre: WorkspaceNav, the three demo flows plus a "More" menu.
 * Right: session and account controls.
 *
 * The metrics strip is deliberately not here any more. It is proof, not
 * navigation, so it renders as its own status line under this bar (see
 * app/app/page.tsx). On phones the bar wraps to two rows: brand and
 * account on the first, the workspace views on the second.
 */

import { useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Bookmark, PanelLeft, Plus, User, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useLens } from "@/lib/store";
import { ThemeToggle } from "./ThemeToggle";
import { PersonaBadge } from "./PersonaBadge";
import { WorkspaceNav } from "./WorkspaceNav";
import { CircleDialog } from "./CircleDialog";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50";

export function TopBar() {
  const { sidebarOpen, toggleSidebar, newSession, setView, openStudyTool } = useLens();
  const [circlesOpen, setCirclesOpen] = useState(false);

  return (
    <header
      className={
        "relative z-30 mx-3 mt-3 grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-2 rounded-[28px] px-3 py-2 glass-raise " +
        "md:h-[56px] md:gap-x-3 md:rounded-full md:px-4 md:py-0"
      }
    >
      {/* Brand + sessions */}
      <div className="col-start-1 row-start-1 flex items-center gap-1 md:gap-2">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-pressed={sidebarOpen}
          aria-label={sidebarOpen ? "Hide recent sessions" : "Show recent sessions"}
          title={sidebarOpen ? "Hide recent sessions" : "Show recent sessions"}
          className={`rounded-full p-2 text-ink-500 transition hover:bg-white/60 hover:text-ink-200 ${FOCUS_RING}`}
        >
          <PanelLeft className="size-4" />
        </button>

        <Link
          href="/app"
          onClick={() => setView("camera")}
          aria-label="LENS — back to Camera"
          title="Back to Camera"
          className={`rounded-full [&_span]:hidden sm:[&_span]:inline ${FOCUS_RING}`}
        >
          <Logo />
        </Link>
      </div>

      {/* Workspace views: second row on phones, centred on wider screens */}
      <div className="col-span-3 col-start-1 row-start-2 flex justify-center md:col-span-1 md:col-start-2 md:row-start-1">
        <WorkspaceNav />
      </div>

      {/* Session + account */}
      <div className="col-start-3 row-start-1 flex items-center gap-1.5 md:gap-2">
        <button
          type="button"
          onClick={() => setCirclesOpen(true)}
          aria-label="Study circles"
          title="Study circles — invite friends"
          className={`flex items-center gap-1.5 rounded-full border border-ink-800/30 bg-white/40 p-2 text-[12px] font-medium text-ink-200 transition hover:border-signal/40 hover:bg-signal/10 md:px-3.5 md:py-2 ${FOCUS_RING}`}
        >
          <Users className="size-3.5" />
          <span className="hidden md:inline">Circles</span>
        </button>

        <button
          type="button"
          onClick={() => openStudyTool("library")}
          aria-label="Library"
          title="Everything you saved, and what you keep missing"
          className={`flex items-center gap-1.5 rounded-full border border-ink-800/30 bg-white/40 p-2 text-[12px] font-medium text-ink-200 transition hover:border-signal/40 hover:bg-signal/10 md:px-3.5 md:py-2 ${FOCUS_RING}`}
        >
          <Bookmark className="size-3.5" />
          <span className="hidden md:inline">Library</span>
        </button>

        <button
          type="button"
          onClick={newSession}
          aria-label="New session"
          title="New session"
          className={`flex items-center gap-1.5 rounded-full border border-ink-800/30 bg-white/40 p-2 text-[12px] font-medium text-ink-200 transition hover:border-signal/40 hover:bg-signal/10 md:px-3.5 md:py-2 ${FOCUS_RING}`}
        >
          <Plus className="size-3.5" />
          <span className="hidden md:inline">New session</span>
        </button>

        <PersonaBadge />
        <ThemeToggle className={FOCUS_RING} />

        {/* The trigger still opens Clerk's real account menu — only the
            photo is swapped for a generic icon, which stays clickable
            underneath since it has no pointer events of its own. */}
        <div className="relative">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "size-8 rounded-full bg-ink-800/10 [&_img]:invisible",
              },
            }}
          />
          <User className="pointer-events-none absolute inset-0 m-auto size-4 text-ink-500" aria-hidden />
        </div>
      </div>

      {circlesOpen && <CircleDialog onClose={() => setCirclesOpen(false)} />}
    </header>
  );
}
