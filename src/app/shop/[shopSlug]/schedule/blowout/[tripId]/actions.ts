"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callTripBlowout, resumeTripBlowout } from "@/db/blowouts";
import { getDb } from "@/db/client";
import { recordTripActivity } from "@/db/operations";
import { trackEvent } from "@/lib/analytics";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

// `shopPath`, not a template literal: `shopSlug` is a server-action argument and
// therefore client-supplied, and interpolating it raw let a slug traverse out of
// the `/shop/` namespace, or carry a `?`/`#` that swallowed the `?notice=`
// appended after it (see src/lib/staff-notices.ts). Each segment is escaped
// instead.
const blowoutPath = (shopSlug: string, tripId: string) =>
  shopPath(shopSlug, "schedule", "blowout", tripId);

/**
 * The one-tap blow-out (docs ADR 20260804-blowout-cascade). Open to all staff,
 * same as `cancelTripAction`: the weather go/no-go is the crew's call
 * (glossary), and this moves no money — the cascade reports payment positions
 * to staff instead of refunding, so the H-14 refund role gate is never
 * bypassed by whoever is on the dock at 6am.
 *
 * Safe to re-run: the cascade resumes pending rows and re-sends nobody
 * (`callTripBlowout`'s idempotency contract).
 */
export async function callBlowoutAction(shopSlug: string, tripId: string) {
  const back = blowoutPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const db = await getDb();
  const outcome = await callTripBlowout(db, {
    shopId: s.user.shopId,
    tripId,
    calledByPersonId: s.user.personId,
  });
  if (!outcome.ok) {
    redirect(noticeUrl(back, outcome.reason === "trip_departed" ? "departed" : "error"));
  }
  await trackEvent({
    name: "blowout_called",
    resumed: outcome.resumed,
    total: outcome.total,
    sent: outcome.sent,
    failed: outcome.failed,
    noEmail: outcome.noEmail,
  });
  if (!outcome.resumed) {
    await recordTripActivity(db, {
      shopId: s.user.shopId,
      tripId,
      actorPersonId: s.user.personId,
      action: "called a weather blow-out",
    });
  }
  refreshBlowoutSurfaces(shopSlug, tripId);
  redirect(noticeUrl(back, outcome.resumed ? "resumed" : "called"));
}

/**
 * Retry the messages a previous pass left failed — flips them back to pending
 * and walks the cascade again. Never touches sent or queued rows.
 */
export async function resumeBlowoutAction(shopSlug: string, tripId: string) {
  const back = blowoutPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const db = await getDb();
  const outcome = await resumeTripBlowout(db, {
    shopId: s.user.shopId,
    tripId,
    calledByPersonId: s.user.personId,
  });
  if (!outcome.ok) redirect(noticeUrl(back, "error"));
  await trackEvent({
    name: "blowout_resumed",
    total: outcome.total,
    sent: outcome.sent,
    failed: outcome.failed,
  });
  refreshBlowoutSurfaces(shopSlug, tripId);
  redirect(noticeUrl(back, "resumed"));
}

/** The surfaces a blow-out changes: this page, the trip, the board, Today. */
function refreshBlowoutSurfaces(shopSlug: string, tripId: string) {
  revalidatePath(blowoutPath(shopSlug, tripId));
  revalidatePath(shopPath(shopSlug, "trips", tripId));
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
  revalidatePath(shopPath(shopSlug));
}
