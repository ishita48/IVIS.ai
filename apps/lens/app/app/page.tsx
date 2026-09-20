"use client";

/**
 * The LENS workspace.
 * ─────────────────────────────────────────────────────────────────────
 * Top to bottom: the TopBar (brand, the workspace views, account), then
 * the metrics status line, then two panels: the tutor on the left, the
 * active mode on the right. The metrics line sits directly under the bar
 * so it is on screen for the entire demo without anyone navigating to it,
 * and out of the bar so it never reads as navigation.
 *
 * This is the only student-facing page under /app; there is no separate
 * student dashboard. The teacher dashboard lives at /app/teacher.
 */

import { useLens } from "@/lib/store";
import { Bootstrap } from "@/components/product/Bootstrap";
import { ConversationProvider } from "@elevenlabs/react";
import { ChatSidebar } from "@/components/product/ChatSidebar";
import { Chat } from "@/components/product/Chat";
import { MetricsStrip } from "@/components/product/MetricsStrip";
import { TopBar } from "@/components/product/TopBar";
import { Toaster } from "@/components/product/Toaster";
import { Workspace } from "@/components/product/Workspace";

export default function AppPage() {
  // The camera is a conversation already — voice in, transcript under the
  // video. A second text chat beside it is the same thing twice, and it
  // costs the camera a third of the screen. Camera mode gets the width.
  const cameraMode = useLens((s) => s.view === "camera");
  return (
    <ConversationProvider>
      <div className="flex min-h-screen flex-col app-canvas">
        <Bootstrap />
        <TopBar />
        {/* Live, computed from the events collection. Visible all demo. */}
        <MetricsStrip />

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4 pt-2">
          <ChatSidebar />

          <div className="grid min-w-0 flex-1 grid-cols-12 gap-4 overflow-hidden">
            {!cameraMode && (
              <aside className="col-span-4 flex min-h-0 flex-col overflow-hidden rounded-3xl glass-panel">
                <Chat />
              </aside>
            )}

            <main
              className={`${cameraMode ? "col-span-12" : "col-span-8"} flex min-h-0 flex-col overflow-hidden rounded-3xl glass-panel`}
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                <Workspace />
              </div>
            </main>
          </div>
        </div>

        <Toaster />
      </div>
    </ConversationProvider>
  );
}
