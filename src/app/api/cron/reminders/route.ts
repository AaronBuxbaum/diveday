import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sendDueRecaps } from "@/db/recap";
import { sendDueReminders } from "@/db/reminders";

export const runtime = "nodejs";

/**
 * The scheduled trip-notification entry point. The app holds no timer by design
 * (docs ADR 20260721-scheduled-reminder-cadence); an external scheduler
 * (Vercel Cron, see vercel.json) hits this daily and both scans do the
 * idempotent work — a reminder or recap already delivered is never re-sent.
 * One endpoint drives both the pre-trip reminders and the post-trip recap
 * (docs first-principles brainstorm C) so a single daily tick covers the whole
 * run-up-and-after of a booking.
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
  const db = await getDb();
  const reminders = await sendDueReminders(db);
  const recaps = await sendDueRecaps(db);
  return NextResponse.json({ reminders, recaps });
}
