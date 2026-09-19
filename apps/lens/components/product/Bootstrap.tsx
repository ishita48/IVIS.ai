"use client";

import { useEffect } from "react";
import { useLens } from "@/lib/store";

export function Bootstrap() {
  const bootstrap = useLens((s) => s.bootstrap);
  const setExtensionConnected = useLens((s) => s.setExtensionConnected);

  useEffect(() => {
    bootstrap();

    // Tell the extension which session the dashboard is currently viewing,
    // so captures land in the same session the user is looking at.
    const broadcastSession = () => {
      const sid = useLens.getState().sessionId;
      if (!sid) return;
      window.postMessage(
        { source: "lens-app", type: "ACTIVE_SESSION", sessionId: sid },
        window.location.origin
      );
    };

    // Re-broadcast whenever the active session changes
    const unsubSession = useLens.subscribe((state, prev) => {
      if (state.sessionId && state.sessionId !== prev.sessionId) {
        broadcastSession();
      }
    });

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "studio-extension") return;
      if (data.type === "READY") {
        setExtensionConnected(true);
        // Extension just woke up — tell it the current session
        broadcastSession();
      }
      if (data.type === "SOURCE_CAPTURED") {
        const store = useLens.getState() as any;
        const currentSid = store.sessionId;
        const capturedSid = data.sessionId || null;
        // If the capture landed in a different chat than what the user is
        // viewing, switch to it so the new source is visible immediately.
        if (capturedSid && capturedSid !== currentSid) {
          // Refresh the sidebar first so switchSession finds the session
          store.loadSessions?.().finally(() => {
            store.switchSession?.(capturedSid).catch(() => {});
          });
        } else if (currentSid) {
          store._loadSessionData?.(currentSid).catch(() => {});
        }
      }
    };

    // Refresh when the user tabs back to the LENS tab after capturing
    const onFocus = () => {
      const sid = useLens.getState().sessionId;
      if (sid) {
        (useLens.getState() as any)._loadSessionData(sid).catch(() => {});
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    // Ping extension in case it loaded before us
    window.postMessage(
      { source: "lens-app", type: "HELLO" },
      window.location.origin
    );

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubSession();
    };
  }, [bootstrap, setExtensionConnected]);

  return null;
}
