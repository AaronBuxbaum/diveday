import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sendDueReminders } from "@/db/reminders";

export const runtime = "nodejs";

/**
 * The scheduled-reminder entry point. The app holds no timer by design
 * (docs ADR 20260721-scheduled-reminder-cadence); an external scheduler
 * (Vercel Cron, see vercel.json) hits this hourly and `sendDueReminders` does
 * the idempotent work — a reminder already delivered is never re-sent.
 *
 * Fails closed: a `CRON_SECRET` must be configured and presented as a bearer
 * token. Without the secret set the endpoint is unavailable (503) rather than
 * open, so nothing can trigger sends in a deployment that forgot to set it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }
  const summary = await sendDueReminders(await getDb());
  return NextResponse.json(summary);
}
