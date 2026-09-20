"use client";

/**
 * WorkspaceNav — where you are, and the three places the demo goes.
 * ─────────────────────────────────────────────────────────────────────
 * Camera and Pointer are the live demo flows; Reasoning is the proof that
 * LENS was tracking. Those three are always visible as a segmented
 * control. Sources (grounding), Study tools (review) and Data (the
 * predict-then-query loop) are real but secondary, so they live behind one
 * "More" trigger. When a secondary view is active, the trigger takes its
 * name and its active colour, so the bar always names the current view.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Crosshair,
  Database,
  GitBranch,
  Layers,
  LayoutGrid,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import { useLens, type WorkspaceView } from "@/lib/store";
import { cn } from "@/lib/cn";

type Tab = { id: WorkspaceView; label: string; icon: LucideIcon; hint: string };

export const PRIMARY_TABS: Tab[] = [
  { id: "camera", label: "Camera", icon: ScanSearch, hint: "Watch me work" },
  { id: "pointer", label: "Pointer", icon: Crosshair, hint: "Point at my screen" },
  { id: "reasoning", label: "Reasoning", icon: GitBranch, hint: "What you think I think" },
];

export const SECONDARY_TABS: Tab[] = [
  { id: "sources", label: "Sources", icon: Layers, hint: "My material" },
  { id: "study", label: "Study tools", icon: BookOpen, hint: "Summaries, cards, quizzes, and video" },
  { id: "data", label: "Data", icon: Database, hint: "Predict, then query a real slice" },
];

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent";

export function WorkspaceNav() {
  const { view, setView } = useLens();
  const activeSecondary = SECONDARY_TABS.find((t) => t.id === view) ?? null;

  return (
    <nav
      aria-label="Workspace views"
      className="flex w-full items-center gap-0.5 rounded-full glass-chip p-1 md:w-fit"
    >
      {PRIMARY_TABS.map((t) => {
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
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12px] transition md:flex-none md:px-3.5",
              FOCUS_RING,
              active
                ? "bg-signal font-semibold text-white shadow-card"
                : "font-medium text-ink-500 hover:bg-white/50 hover:text-ink-200"
            )}
          >
            <Icon className="hidden size-3.5 shrink-0 sm:block" />
            <span className="truncate">{t.label}</span>
          </button>
        );
      })}

      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-ink-800/60" />

      <MoreMenu active={activeSecondary} onPick={setView} />
    </nav>
  );
}

function MoreMenu({
  active,
  onPick,
}: {
  active: Tab | null;
  onPick: (view: WorkspaceView) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Outside click closes the menu. A listener rather than a full-screen
  // overlay, so the bar's own stacking context never has to fight it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  // First item takes focus when the menu opens.
  useEffect(() => {
    if (!open) return;
    const first = rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
      );
      if (items.length === 0) return;
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === "ArrowDown"
          ? items[(i + 1) % items.length]
          : items[(i - 1 + items.length) % items.length];
      next.focus();
    }
  }

  function onBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Tabbing out of the menu closes it without trapping focus.
    if (!rootRef.current?.contains(e.relatedTarget as Node)) close();
  }

  const TriggerIcon = active ? active.icon : LayoutGrid;

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={active ? "page" : undefined}
        title={active ? active.hint : "Sources, study tools and data"}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] transition md:px-3",
          FOCUS_RING,
          active
            ? "bg-signal font-semibold text-white shadow-card"
            : "font-medium text-ink-500 hover:bg-white/50 hover:text-ink-200"
        )}
      >
        <TriggerIcon className="size-3.5 shrink-0" />
        <span className={cn("max-w-[96px] truncate", !active && "hidden sm:inline")}>
          {active ? active.label : "More"}
        </span>
        <ChevronDown
          className={cn("size-3 shrink-0 transition", open && "rotate-180", !active && "text-ink-500")}
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="More views"
          className="absolute right-0 top-[calc(100%+8px)] z-20 w-60 rounded-2xl border border-ink-800/30 bg-white/90 p-1.5 shadow-lift backdrop-blur-xl"
        >
          {SECONDARY_TABS.map((t) => {
            const Icon = t.icon;
            const isActive = active?.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onPick(t.id);
                  close(true);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-signal/10",
                  FOCUS_RING,
                  isActive && "bg-signal/10"
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-signal-deep" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink-100">{t.label}</span>
                  <span className="block text-[11px] leading-snug text-ink-500">{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
