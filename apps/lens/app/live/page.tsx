"use client";

/**
 * /live — LENS as a spoken tutor.
 *
 * ConversationProvider must wrap anything calling useConversation(), which is
 * why it sits here rather than inside useAgent.
 */

import { ConversationProvider } from "@elevenlabs/react";
import { CameraView } from "@/components/Camera/CameraView";
import { Logo } from "@/components/Logo";

export default function LivePage() {
  return (
    <main className="min-h-screen app-canvas">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        <Logo />
        <p className="text-[13px] text-ink-500">
          Talk to it. It looks only when it needs to.
        </p>
      </header>

      <ConversationProvider>
        <CameraView />
      </ConversationProvider>
    </main>
  );
}
