"use client";

/**
 * Camera and Pointer are the live demo flows; Knowledge map is the proof
 * that LENS was tracking; Sources is grounding; Study is review; Data is
 * the predict-then-query loop on a committed slice.
 */

import { BookOpen, Crosshair, Database, GitBranch, Layers, ScanSearch } from "lucide-react";
import { useLens, type WorkspaceView } from "@/lib/store";
import { cn } from "@/lib/cn";

const TABS: { id: WorkspaceView; label: string; icon: any; hint: string }[] = [
  { id: "camera", label: "Camera", icon: ScanSearch, hint: "Watch me work" },
  { id: "pointer", label: "Pointer", icon: Crosshair, hint: "Point at my screen" },
  { id: "reasoning", label: "Knowledge map", icon: GitBranch, hint: "What you think I think" },
  { id: "sources", label: "Sources", icon: Layers, hint: "My material" },
  { id: "study", label: "Study tools", icon: BookOpen, hint: "Summaries, cards, quizzes, and video" },
  { id: "data", label: "Data", icon: Database, hint: "Predict, then query a real slice" },
];

export function WorkspaceNav() {
  const { view, setView } = useLens();

  return (
    <div className="flex justify-center px-4 py-3">
      <div className="flex w-fit items-center gap-1 rounded-full glass-chip p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = view === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              title={t.hint}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] transition",
                active
                  ? "bg-signal font-semibold text-white shadow-card"
                  : "text-ink-500 hover:bg-white/50 hover:text-ink-200"
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
