import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDetection } from "@/lib/ops";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // image checks can take a while

// Called on a schedule (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !given) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const a = Buffer.from(expected), b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runDetection()) });
  } catch (e) {
    console.error("alert detection failed", e);
    return NextResponse.json({ error: "Detection failed." }, { status: 503 });
  }
}
