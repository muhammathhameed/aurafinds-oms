import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Reports which required settings are missing (names only, never values).
export function GET() {
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"];
  const missing = required.filter((name) => !process.env[name]);
  return NextResponse.json({ ok: missing.length === 0, missing }, { status: missing.length ? 503 : 200 });
}
