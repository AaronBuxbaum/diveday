import { and, eq, sql } from "drizzle-orm";
import { signRecapToken, verifyRecapToken } from "@/lib/recap-links";
import type { DbExecutor } from "./client";
import { bookings } from "./schema";

/**
 * **The recap link's one door** (issue #3982). The token is a signed booking
 * id and epoch (`src/lib/recap-links.ts`); it opens only while the booking
 * still holds that epoch, so a link mailed to an address since corrected opens
 * nothing. Every recap surface (the page, its actions, the photo upload, the
 * dive log, the link preview) reads the booking through this, never through
 * `verifyRecapToken` alone.
 */
export async function openRecapLink(db: DbExecutor, token: string): Promise<string | null> {
  const claim = verifyRecapToken(token);
  if (!claim) return null;
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, claim.bookingId), eq(bookings.recapLinkEpoch, claim.epoch)))
    .limit(1);
  return booking?.id ?? null;
}

/** A recap token for the booking at its current epoch, or null for no such booking. */
export async function recapTokenFor(db: DbExecutor, bookingId: string): Promise<string | null> {
  const [booking] = await db
    .select({ epoch: bookings.recapLinkEpoch })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return booking ? signRecapToken(bookingId, booking.epoch) : null;
}

/**
 * Retire every recap link to one person's bookings in a shop: the epoch moves
 * on, and a link signed under the old one opens nothing. Called with every
 * change to the person's email or phone (`revokeLinksSentToOldContact`).
 */
export async function retireRecapLinks(
  db: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<void> {
  await db
    .update(bookings)
    .set({ recapLinkEpoch: sql`${bookings.recapLinkEpoch} + 1` })
    .where(and(eq(bookings.shopId, input.shopId), eq(bookings.personId, input.personId)));
}
