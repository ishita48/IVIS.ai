/**
 * POST /api/dropbox/ingest   (sponsor track — Dropbox)
 *
 * Course folder → personalized tutor. Dropbox's own challenge brief names
 * this exact use case, which is why it maps onto LENS's Sources tier with
 * no product contortion: a connected folder becomes the grounding corpus
 * the reasoning engine cites.
 *
 * Owner: Person 4.
 *
 * THIS IS A SCAFFOLD, NOT A WORKING INTEGRATION. It intentionally does not
 * fake a response — an unimplemented integration that returns plausible
 * JSON is worse than one that 501s, because you find out on stage. Finish
 * the two TODOs below and it becomes real.
 *
 * Shape of the work (all of it reuses pipeline that already exists):
 *   1. OAuth: redirect to Dropbox, store the access token on the user doc.
 *   2. files/list_folder → for each file, files/download → Buffer.
 *   3. Pipe the Buffer through lib/extract.ts (PDF/docx/text already handled).
 *   4. Insert into `sources` exactly like /api/sources/upload does, then
 *      embedSourceFireAndForget() — retrieval then works with zero changes.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "Dropbox is not connected. Set DROPBOX_ACCESS_TOKEN (or finish the OAuth flow) before calling this.",
      },
      { status: 501 }
    );
  }

  // TODO(Person 4): list the folder, download each file, extract, embed.
  // Mirror /api/sources/upload — do not write a second ingestion pipeline.
  return NextResponse.json(
    {
      error:
        "Dropbox ingestion is not implemented yet. See the TODO in this file — do not ship a stubbed response to the demo.",
    },
    { status: 501 }
  );
}
