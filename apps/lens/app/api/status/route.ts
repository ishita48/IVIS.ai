import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export const runtime = "nodejs";

function cors(origin: string | null) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-credentials": "true",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: cors(req.headers.get("origin")),
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const headers = cors(origin);

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { signedIn: false, sourcesCount: 0, aiAvailable: !!process.env.OPENAI_API_KEY },
        { headers }
      );
    }

    const db = await getDb();
    const sourcesCount = await db
      .collection("sources")
      .countDocuments({ userId, active: true });

    return NextResponse.json(
      {
        signedIn: true,
        sourcesCount,
        aiAvailable: !!process.env.OPENAI_API_KEY,
      },
      { headers }
    );
  } catch (err) {
    // Don't 500 the extension — return a clean "not signed in" so the popup
    // shows a helpful state instead of "API error 500".
    console.error("[/api/status]", err);
    return NextResponse.json(
      { signedIn: false, sourcesCount: 0, aiAvailable: !!process.env.OPENAI_API_KEY },
      { headers }
    );
  }
}
