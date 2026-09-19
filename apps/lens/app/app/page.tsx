"use client";

/**
 * The LENS workspace.
 * ─────────────────────────────────────────────────────────────────────
 * Two panels: the tutor on the left, the active mode on the right. The
 * metrics strip lives in the TopBar so it is on screen for the entire
 * demo without anyone navigating to it.
 */

import { Bootstrap } from "@/components/product/Bootstrap";
import { ConversationProvider } from "@elevenlabs/react";
import { ChatSidebar } from "@/components/product/ChatSidebar";
import { Chat } from "@/components/product/Chat";
import { TopBar } from "@/components/product/TopBar";
import { Toaster } from "@/components/product/Toaster";
import { Workspace } from "@/components/product/Workspace";
import { WorkspaceNav } from "@/components/product/WorkspaceNav";

export default function AppPage() {
  return (
    <ConversationProvider>
      <div className="flex min-h-screen flex-col app-canvas">
        <Bootstrap />
        <TopBar />

      <div className="flex h-[calc(100vh-49px)] gap-3 overflow-hidden p-3">
        <ChatSidebar />

        <div className="grid min-w-0 flex-1 grid-cols-12 gap-3 overflow-hidden">
          <aside className="col-span-4 flex min-h-0 flex-col overflow-hidden rounded-3xl glass-panel">
            <Chat />
          </aside>

          <main className="col-span-8 flex min-h-0 flex-col overflow-hidden rounded-3xl glass-panel">
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
