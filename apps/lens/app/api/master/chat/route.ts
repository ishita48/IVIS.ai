import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { llmStream, type LlmMessage } from "@/lib/llm";
import { hybridSearchElastic } from "@/lib/elastic";
import { recordEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `You are LENS, a tutor that watches how a student works and does not immediately give the answer.

Rules:
- Use the student's own material when excerpts are provided.
- Ask one useful question before explaining.
- Never invent facts, sources, observations, or tool results.
- Do not claim to have seen the camera unless the camera tool returned an observation.
- Be concise and practical. Keep responses to two short paragraphs or fewer.
- If the student asks for the direct answer, offer the smallest next hint instead.`;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    sessionId?: string | null;
    history?: LlmMessage[];
  };
  const message = String(body.message || "").trim();
  if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 });

  let sourceContext = "";
  try {
    const hits = await hybridSearchElastic({ userId, query: message, k: 4 });
    if (hits.length) {
      sourceContext = `\n\nRelevant excerpts from the student's material:\n${hits
        .map((hit: any) => `- ${hit.title}: ${String(hit.text || hit.extractedText || "").slice(0, 900)}`)
        .join("\n")}`;
    }
  } catch {
    // Chat remains usable when retrieval is temporarily unavailable.
  }

  const history = Array.isArray(body.history)
    ? body.history
        .filter((item) => item && (item.role === "user" || item.role === "assistant"))
        .slice(-10)
    : [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (value: string) => controller.enqueue(encoder.encode(value));
      try {
        for await (const delta of llmStream(SYSTEM + sourceContext, history, message, {
          ledger: body.sessionId ? { sessionId: body.sessionId, userId } : null,
          purpose: "master.chat",
        })) {
          write(sse("delta", { text: delta }));
        }
        if (body.sessionId) {
          await recordEvent({
            sessionId: body.sessionId,
            userId,
            type: "voice_turn",
            payload: { role: "user", text: message, channel: "chat" },
          }).catch(() => undefined);
        }
        write(sse("done", { ok: true }));
      } catch (error) {
        write(sse("error", { text: error instanceof Error ? error.message : "Chat failed" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}