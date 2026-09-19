import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { globalSearch } from "@/lib/aggregations";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  const results = await globalSearch(userId, q);
  return NextResponse.json(results);
}
