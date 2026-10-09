"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { reserveGearUnit } from "@/db/gear";
import { getShopById } from "@/db/shops";
import { getTripWithBooked, screenGearPicks } from "@/db/trips";
import { tripReservationWindow } from "@/lib/gear";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * The most picks one confirm carries: a full liveaboard's divers times every
 * piece a fit can ask for, with room to spare. A post past it is not a boat.
 */
const MAX_PICKS = 400;

const confirmSchema = z.object({
  tripId: z.uuid(),
  picks: z
    .array(z.object({ bookingId: z.uuid(), gearItemId: z.uuid() }))
    .min(1)
    .max(MAX_PICKS)
    // The page never sends one unit twice, nor one pair twice; a post that
    // does is forged or replayed, and is refused whole rather than half run.
    .refine(
      (picks) =>
        new Set(picks.map((pick) => `${pick.bookingId}:${pick.gearItemId}`)).size === picks.length,
    )
    .refine((picks) => new Set(picks.map((pick) => pick.gearItemId)).size === picks.length),
});

/** How many proposals became reservations, and how many the write refused. */
export type ConfirmProposalsResult =
  | { ok: true; assigned: number; refused: number }
  | { ok: false; reason: "invalid" };

/**
 * **Every proposed unit on the Gear tab, confirmed in one tap** (UX audit
 * 2026-10-07, item 9).
 *
 * The client sends the picks the staffer was shown — what they confirmed is
 * what is reserved, never a fresh proposal computed behind their back — and
 * each one goes through `reserveGearUnit` exactly as a single pick does in
 * `assignGearUnit` (`./actions.ts`): the session, the shop and trip re-read by
 * `session.user.shopId`, the window derived here from the trip row, and
 * `tripId` pinned into every reservation so a booking from another departure,
 * or another shop, is refused by the write rather than by trust. Availability
 * is still never pre-checked: a unit somebody took in the meantime comes back
 * refused from the exclusion constraint, is counted, and its row stays open
 * for a person to pick.
 *
 * Before anything is reserved, the picks are held to what the departure
 * still wants (`screenGearPicks`): a stale tab cannot give a diver a second
 * BCD, or a kind they never asked for, and a unit whose service clock lapsed
 * or that gained an open service concern since the tab loaded is not
 * reserved on a proposal nobody looked at again. A pick that is screened out, refused
 * by the write, or throws is counted as refused, and the page is revalidated
 * whatever happened, so the rows show what is really held.
 *
 * A cancelled departure reserves nothing, here as on the page (dive-domain
 * review 20260920).
 */
export async function confirmProposedGearUnits(input: {
  tripId: string;
  picks: { bookingId: string; gearItemId: string }[];
}): Promise<ConfirmProposalsResult> {
  const session = await requireStaffSession();
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const db = await getDb();
  const [shop, trip] = await Promise.all([
    getShopById(db, session.user.shopId),
    getTripWithBooked(db, session.user.shopId, parsed.data.tripId),
  ]);
  if (!shop || !trip || trip.status === "cancelled") return { ok: false, reason: "invalid" };

  const window = tripReservationWindow(trip, shop.timezone);
  let assigned = 0;
  let refused = 0;
  try {
    // Every pick here is a proposal, so its care is re-read too: a unit that
    // gained a lapsed clock or an open concern since the tab loaded is
    // refused and its row left for a person (second dive-domain review).
    const screened = await screenGearPicks(db, shop, parsed.data.tripId, parsed.data.picks, {
      proposed: true,
    });
    refused += screened.refused;
    // One at a time, in the order shown.
    for (const pick of screened.kept) {
      try {
        const outcome = await reserveGearUnit(db, {
          shopId: shop.id,
          gearItemId: pick.gearItemId,
          bookingId: pick.bookingId,
          tripId: parsed.data.tripId,
          reservedFrom: window.from,
          reservedUntil: window.until,
          // Held under the booking's lock to the write: a second tablet's
          // "Assign all" cannot give this diver a second unit of the kind
          // (issue #2215). Its refusal is counted like any other.
          screen: { proposed: true },
        });
        if (outcome.ok) assigned += 1;
        else refused += 1;
      } catch {
        // One pick's failure is that row's to show, not the other twenty's.
        refused += 1;
      }
    }
  } finally {
    revalidatePath(shopPath(session.user.shopSlug, "trips", parsed.data.tripId, "prep"));
  }
  return { ok: true, assigned, refused };
}
