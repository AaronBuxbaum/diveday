import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { retryPendingMediaDeletions } from "@/db/media-deletions";
import { sendDueRecaps } from "@/db/recap";
import { sendDueReminders } from "@/db/reminders";
import { reapExpiredDemoShops } from "@/db/seed";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a minted demo shop lives before the reaper clears it. Defaults to 7
 * days (ADR 20260724-per-visitor-demo-shops); `DEMO_SHOP_TTL_DAYS` overrides it,
 * ignoring any non-positive or non-numeric value.
 */
function demoShopMaxAgeMs(): number | undefined {
  const days = Number(process.env.DEMO_SHOP_TTL_DAYS);
  return Number.isFinite(days) && days > 0 ? days * DAY_MS : undefined;
}

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
 *
 * The same daily tick also drives CR-012's bounded orphan-media cleanup: a
 * provider delete that failed or never resolved gets retried automatically
 * here, so a transient Blob outage doesn't require a human to notice the
 * reports-page reconciliation panel and click "Retry" by hand.
 *
 * It also reaps disposable demo shops past their TTL (ADR
 * 20260724-per-visitor-demo-shops): "Try the live demo" mints a fresh seeded
 * shop per visitor, and this daily pass deletes the expired ones so the database
 * doesn't grow without bound. The canonical blue-mantis demo is never reaped.
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
  const mediaDeletions = await retryPendingMediaDeletions(db);
  // Clear disposable demo shops past their TTL so per-visitor minting doesn't
  // grow the database without bound (ADR 20260724-per-visitor-demo-shops).
  const maxAgeMs = demoShopMaxAgeMs();
  const demoShops = await reapExpiredDemoShops(db, maxAgeMs ? { maxAgeMs } : {});
  return NextResponse.json({ reminders, recaps, mediaDeletions, demoShops });
}
