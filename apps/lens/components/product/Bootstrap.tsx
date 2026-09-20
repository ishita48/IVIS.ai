"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { setSessionScope, useLens } from "@/lib/store";

export function Bootstrap() {
  const bootstrap = useLens((s) => s.bootstrap);
  const setExtensionConnected = useLens((s) => s.setExtensionConnected);
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    // Namespace the resumed-session key to whoever is signed in BEFORE
    // anything reads it. Signing out and back in as someone else used to
    // leave the previous account's session id in a shared key, so the next
    // person booted pointing at it.
    if (!isLoaded) return;
    setSessionScope(userId ?? null);

    // `/app?session=<id>` opens that session instead of the resumed one.
    // This is how a circle's shared room is entered, from the Circles
    // dialog and from the end of /join/[code]. The id is not trusted: the
    // server decides whether this account may read it, and hands back a
    // fresh private session if not — so a guessed id opens an empty room
    // of one's own rather than someone else's work.
    //
    // The param is stripped afterwards so a refresh does not keep yanking
    // the student back into the group when they have since moved on, and
    // so the id does not sit in the address bar to be copied around.
    const requested =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("session");

    if (requested) {
      window.history.replaceState({}, "", window.location.pathname);
      void useLens
        .getState()
        .switchSession(requested)
        .catch(() => bootstrap());
      void useLens.getState().loadSessions?.();
    } else {
      bootstrap();
    }

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
      if (!data || data.source !== "lens-extension") return;
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
  }, [bootstrap, setExtensionConnected, isLoaded, userId]);

  return null;
}
