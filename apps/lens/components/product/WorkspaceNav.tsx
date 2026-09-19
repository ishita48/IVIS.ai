"use client";

/**
 * Four tabs. That is the whole product surface, and keeping it at four is
 * a deliberate decision — StudyO had eight and the story got diluted.
 * Camera and Pointer are the two live demo flows; Reasoning is the proof
 * that LENS was tracking the whole time; Sources is the grounding tier.
 */

import { Crosshair, GitBranch, Layers, ScanSearch } from "lucide-react";
import { useLens, type WorkspaceView } from "@/lib/store";
import { cn } from "@/lib/cn";

const TABS: { id: WorkspaceView; label: string; icon: any; hint: string }[] = [
  { id: "camera", label: "Camera", icon: ScanSearch, hint: "Watch me work" },
  { id: "pointer", label: "Pointer", icon: Crosshair, hint: "Point at my screen" },
  { id: "reasoning", label: "Reasoning", icon: GitBranch, hint: "What you think I think" },
  { id: "sources", label: "Sources", icon: Layers, hint: "My material" },
];

export function WorkspaceNav() {
  const { view, setView } = useLens();

  return (
    <div className="relative flex items-center gap-1 px-4 py-2">
      <div className="absolute inset-x-4 bottom-0 h-px glass-divider" />
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = view === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            title={t.hint}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] transition",
              active
                ? "bg-signal text-ink-950 font-semibold shadow-card"
                : "text-ink-500 hover:bg-white/50 hover:text-ink-200"
            )}
          >
            <Icon className="size-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
