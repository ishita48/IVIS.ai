"use client";

/**
 * /live — LENS as a spoken tutor.
 *
 * ConversationProvider must wrap anything calling useConversation(), which is
 * why it sits here rather than inside useAgent.
 */

import { ConversationProvider } from "@elevenlabs/react";
import { CameraView } from "@/components/Camera/CameraView";

export default function LivePage() {
  return (
    <main className="min-h-screen bg-zinc-950">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
            LENS · live
          </h1>
          <p className="text-[13px] text-zinc-500">
            Talk to it. It looks only when it needs to.
          </p>
        </div>
      </header>

      <ConversationProvider>
        <CameraView />
      </ConversationProvider>
    </main>
  );
}
