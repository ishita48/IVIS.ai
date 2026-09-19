import { NextResponse } from "next/server";
import { analyze } from "@/lib/reasoning";
import { formatOpenAIError, openAIErrorStatus } from "@/lib/openai-errors";
import type { RunResult } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      problem?: string;
      code?: string;
      run?: RunResult;
      history?: string[];
      priorAttempts?: number;
    };

    if (
      typeof body.problem !== "string" ||
      typeof body.code !== "string" ||
      !body.run ||
      !Array.isArray(body.history) ||
      typeof body.priorAttempts !== "number"
    ) {
      throw new Error(
        "Missing required fields: problem, code, run, history, priorAttempts"
      );
    }

    const result = await analyze({
      problem: body.problem,
      code: body.code,
      run: body.run,
      history: body.history,
      priorAttempts: body.priorAttempts,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: formatOpenAIError(error) },
      { status: openAIErrorStatus(error) }
    );
  }
}
