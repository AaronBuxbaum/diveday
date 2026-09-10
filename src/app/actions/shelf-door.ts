"use server";

import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { issueShelfToken, verifyShelfToken } from "@/db/person-shelf-tokens";
import { bookings, people } from "@/db/schema";
import { sendShelfLink } from "@/db/shelf-link-send";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { publicSchedulePath } from "@/lib/public-routes";
import { verifyRecapToken } from "@/lib/recap-links";
import { SHELF_COOKIE, shelfLinkPath } from "@/lib/shelf-links";

/**
 * **The two doors onto the shelf from the thread and the recap** — and the
 * reason there are two rather than one.
 *
 * `/ready/<token>` carries a **stored, revocable** booking capability. It is
 * the diver's own private link, the one place the product already lets a
 * handoff be minted (ADR 20260906-before-you-ask, decision 3), and a shelf
 * token minted from it is a lateral move: the holder could already read this
 * diver's prep state. So that door opens the shelf directly.
 *
 * `/recap/<token>` is **signed for 180 days, cannot be revoked, and is written
 * to be forwarded** — the page has a "Share with a buddy" control on it. A
 * shelf token minted from that link would hand whoever the recap reached a
 * standing door onto the diver's file. So that door mints nothing for the
 * bearer: it mails the link to the address already on the booking, which is a
 * message only the real diver can read.
 *
 * This is the same split `buildAfterStateProps`' `mintHandoff` already makes,
 * stated again here because the consequence is larger.
 */

/**
 * **Open the shelf whose token is in this browser's cookie.**
 *
 * The storefront's "Yours" group needs a way to the shelf, and an `href`
 * carrying the token would print the capability into the HTML of the shop's
 * public page — undoing the whole reason the cookie is `HttpOnly`. So the link
 * is a POST that reads the cookie server-side and redirects; the token never
 * reaches the document.
 *
 * A missing or dead cookie lands on the shop's own storefront, which is where
 * the reader already was.
 */
export async function openMyShelfAction(shopSlug: string): Promise<void> {
  const token = (await cookies()).get(SHELF_COOKIE)?.value;
  if (!token) redirect(publicSchedulePath(shopSlug));
  const db = await getDb();
  const capability = await verifyShelfToken(db, { token });
  redirect(capability ? shelfLinkPath(token) : publicSchedulePath(shopSlug));
}

/**
 * Mint a shelf link for the diver this readiness capability belongs to, and
 * open it.
 *
 * **The one thing this trades, stated rather than left implicit:** a readiness
 * capability dies thirty days after its trip, and the shelf link it mints
 * stands for a year, so a leaked thread link becomes a longer-lived door than
 * the one it was leaked from. Three things bound that, and they are why this is
 * the shape rather than a shorter-lived token nobody would keep. The shelf
 * shows strictly *less* than the thread does — no contact details, no money, no
 * prep state, and never a medical answer. Erasure revokes every shelf link a
 * person holds along with every booking capability, so the two die together
 * where it matters. And every mint is its own row, which is what makes the
 * diver record's "how many phones hold it" the shop's own detection surface: an
 * extra phone on that count is the tell, and it is on the record a staffer
 * already opens.
 */
export async function openShelfFromThreadAction(readinessToken: string): Promise<void> {
  const db = await getDb();
  const capability = await verifyBookingCapability(db, {
    token: readinessToken,
    purpose: "readiness",
  });
  if (!capability) redirect(readinessLinkPath(readinessToken));

  const [seat] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.id, capability.bookingId),
        eq(bookings.shopId, capability.shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  if (!seat) redirect(readinessLinkPath(readinessToken));

  const issued = await issueShelfToken(db, {
    shopId: capability.shopId,
    personId: seat.personId,
  });
  redirect(issued ? shelfLinkPath(issued.token) : readinessLinkPath(readinessToken));
}

/**
 * Mail the shelf link to the address on this recap's booking.
 *
 * One outcome word for every refusal, on purpose: a forwarded recap must not
 * become a way to find out whether a diver has an address on file, so "no
 * email", "no such booking" and "the provider refused" all land on the same
 * `?shelf=failed`. Only a genuine hand-off to the provider says `sent`.
 */
export async function mailShelfFromRecapAction(recapToken: string): Promise<void> {
  const back = `/recap/${recapToken}`;
  const bookingId = verifyRecapToken(recapToken);
  if (!bookingId) redirect(`${back}?shelf=failed`);
  const db = await getDb();
  const [seat] = await db
    .select({ shopId: bookings.shopId, personId: bookings.personId })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.id, bookingId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  if (!seat) redirect(`${back}?shelf=failed`);
  const outcome = await sendShelfLink(db, { shopId: seat.shopId, personId: seat.personId });
  redirect(`${back}?shelf=${outcome === "sent" ? "sent" : "failed"}`);
}
