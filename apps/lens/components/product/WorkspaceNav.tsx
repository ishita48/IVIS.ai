"use client";

/**
 * WorkspaceNav — every view, on one row.
 * ─────────────────────────────────────────────────────────────────────
 * Camera and Pointer are the live demo flows; Knowledge map is the proof
 * that LENS was tracking; Sources is grounding; Study tools is review;
 * Code is the Proof tier, the one tab where the verdict is execution
 * rather than a model.
 *
 * This was briefly a segmented control over the three demo flows with the
 * other three behind a "More" dropdown. That is the right instinct for a
 * nav that has to survive a phone, and the wrong one for this product: a
 * judge watching a two-minute demo should see how much LENS does without
 * anyone opening a menu, and a student should not have to remember that
 * Code lives behind a chevron. Six is few enough to show.
 *
 * Narrow screens wrap to a second line rather than collapsing, so nothing
 * is ever hidden — the labels drop below `sm` and the icons carry it.
 *
 * The labels get a small editorial accent (italic serif) since these six
 * are the whole feature set, not just tab chrome. The camera icon breathes
 * gently at rest since it's the hero interaction — an invitation, not just
 * a destination — and calms once it's the active tab.
 */

import {
  BookOpen,
  Code2,
  Crosshair,
  GitBranch,
  Layers,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import { useLens, type WorkspaceView } from "@/lib/store";
import { cn } from "@/lib/cn";

type Tab = { id: WorkspaceView; label: string; icon: LucideIcon; hint: string };

export const TABS: Tab[] = [
  { id: "camera", label: "Camera", icon: ScanSearch, hint: "Watch me work" },
  { id: "pointer", label: "Pointer", icon: Crosshair, hint: "Point at my screen" },
  { id: "reasoning", label: "Knowledge map", icon: GitBranch, hint: "What you think I think" },
  { id: "sources", label: "Sources", icon: Layers, hint: "My material" },
  {
    id: "study",
    label: "Study tools",
    icon: BookOpen,
    hint: "Summaries, cards, quizzes, and video",
  },
  {
    id: "code",
    label: "Code",
    icon: Code2,
    hint: "Debug real code — it runs, nothing is guessed",
  },
];

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent";

export function WorkspaceNav() {
  const view = useLens((s) => s.view);
  const setView = useLens((s) => s.setView);

  return (
    <nav
      aria-label="Workspace views"
      className="flex w-full flex-wrap items-center justify-center gap-0.5 rounded-full glass-chip p-1 md:w-fit md:flex-nowrap"
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = view === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            title={t.hint}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] transition md:px-3",
              FOCUS_RING,
              active
                ? "bg-signal font-semibold text-white shadow-card"
                : "font-medium text-ink-500 hover:bg-white/50 hover:text-ink-200"
            )}
          >
            <Icon className={cn("size-3.5 shrink-0", t.id === "camera" && !active && "animate-breathe")} />
            <span className="hidden font-serif italic sm:inline">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
