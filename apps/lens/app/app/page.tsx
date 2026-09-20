"use client";

/**
 * The LENS workspace.
 * ─────────────────────────────────────────────────────────────────────
 * Two panels: the tutor on the left, the active mode on the right. The
 * metrics strip lives in the TopBar so it is on screen for the entire
 * demo without anyone navigating to it.
 */

import { useLens } from "@/lib/store";
import { Bootstrap } from "@/components/product/Bootstrap";
import { ConversationProvider } from "@elevenlabs/react";
import { ChatSidebar } from "@/components/product/ChatSidebar";
import { Chat } from "@/components/product/Chat";
import { TopBar } from "@/components/product/TopBar";
import { Toaster } from "@/components/product/Toaster";
import { Workspace } from "@/components/product/Workspace";
import { WorkspaceNav } from "@/components/product/WorkspaceNav";

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

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <ChatSidebar />

        <div className="grid min-w-0 flex-1 grid-cols-12 gap-4 overflow-hidden">
          {!cameraMode && (
            <aside className="col-span-4 flex min-h-0 flex-col overflow-hidden rounded-xl border border-ink-800/12 bg-white/70 shadow-soft">
              <Chat />
            </aside>
          )}

          <main
            className={`${cameraMode ? "col-span-12" : "col-span-8"} flex min-h-0 flex-col overflow-hidden rounded-xl border border-ink-800/12 bg-white/70 shadow-soft`}
          >
            <WorkspaceNav />
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
