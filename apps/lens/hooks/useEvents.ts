"use client";

/**
 * useEvents — keeps the event log and metrics fresh while a session is live.
 * Owner: Person 4.
 *
 * Polling, not websockets: the demo is one user on one machine, and a 4s
 * poll is three lines of code instead of a socket layer to debug at 4am.
 * Revisit after the hackathon, not during it.
 */

import { useEffect } from "react";
import { useLens } from "@/lib/store";

export function useEvents(intervalMs = 4000) {
  const sessionId = useLens((s) => s.sessionId);
  const refreshEvents = useLens((s) => s.refreshEvents);
  const refreshMetrics = useLens((s) => s.refreshMetrics);

  useEffect(() => {
    if (!sessionId) return;
    refreshEvents();
    refreshMetrics();
    const id = setInterval(() => {
      refreshEvents();
      refreshMetrics();
    }, intervalMs);
    return () => clearInterval(id);
  }, [sessionId, intervalMs, refreshEvents, refreshMetrics]);

  return {
    events: useLens((s) => s.events),
    metrics: useLens((s) => s.metrics),
  };
}
