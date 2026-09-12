"use server";

import { and, desc, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { issueBookingHandoff } from "@/db/booking-handoff";
import { type AppDb, getDb } from "@/db/client";
import { recordShelfOpen, verifyShelfToken } from "@/db/person-shelf-tokens";
import { saveRentalFitSizes } from "@/db/rental-fit";
import { bookings, shops, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips-live";
import { savePersonEmergencyContact } from "@/db/waivers";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { handoffHref } from "@/lib/booking-handoff";
import { readEmergencyContact } from "@/lib/contact";
import { publicTripPath } from "@/lib/public-routes";
import {
  SHELF_COOKIE,
  SHELF_COOKIE_MAX_AGE,
  shelfCookiePath,
  shelfLinkPath,
} from "@/lib/shelf-links";

/**
 * Everything `/shelf/[token]` can be asked to do.
 *
 * **Every action re-verifies the token and takes the shop and the person from
 * it.** Not one of them reads a shop id, a person id, or a slug from its form:
 * the capability is the only thing that says whose file this is, and a
 * server action is a public POST endpoint that anybody can call with any body.
 * A refused verification lands on the page's own dead-end rather than throwing,
 * so a stale tab behaves like a stale link instead of an error.
 */

const shelfBase = (token: string) => shelfLinkPath(token);

type ShelfContext = { db: AppDb; shopId: string; personId: string; tokenId: string };

async function contextFor(token: string): Promise<ShelfContext | null> {
  const db = await getDb();
  const capability = await verifyShelfToken(db, { token });
  return capability ? { db, ...capability } : null;
}

/**
 * **Remember this phone, and count the visit.**
 *
 * Fired from a client effect on the shelf rather than during the page's render,
 * for two reasons that point the same way. Setting a cookie is not something a
 * Server Component may do, and a page that writes on GET counts a link
 * preview's fetch as a diver opening their file. One POST, once per mount, does
 * both honestly.
 *
 * The cookie is **HttpOnly**: nothing in the browser reads it — the storefront's
 * greeting is chosen during the server render — so it has no business being
 * script-readable, and a bearer token that scripts cannot reach is one fewer
 * thing an injected script can walk off with.
 *
 * Its path is this shop's storefront and nothing else (`shelfCookiePath`), so
 * a diver who dives with two shops carries one cookie per shop and neither
 * shop's pages ever see the other's.
 */
export async function rememberShelfAction(token: string): Promise<void> {
  const ctx = await contextFor(token);
  if (!ctx) return;
  const [shop] = await ctx.db
    .select({ slug: shops.slug })
    .from(shops)
    .where(eq(shops.id, ctx.shopId))
    .limit(1);
  if (!shop) return;

  await recordShelfOpen(ctx.db, { tokenId: ctx.tokenId });
  (await cookies()).set(SHELF_COOKIE, token, {
    path: shelfCookiePath(shop.slug),
    maxAge: SHELF_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

/**
 * **Forget this phone** — and nothing else.
 *
 * Clears the cookie the greeting reads and stops there. It deliberately does
 * **not** revoke the link: a diver tidying up a borrowed phone's storefront is
 * not asking the shop to close their file, and a control that quietly did both
 * would be the one destructive act on this page wearing the mildest word on it.
 * Revoking is the shop's, from the diver's record.
 */
export async function forgetShelfAction(token: string): Promise<void> {
  const ctx = await contextFor(token);
  if (!ctx) redirect(shelfBase(token));
  const [shop] = await ctx.db
    .select({ slug: shops.slug })
    .from(shops)
    .where(eq(shops.id, ctx.shopId))
    .limit(1);
  if (shop) {
    (await cookies()).delete({ name: SHELF_COOKIE, path: shelfCookiePath(shop.slug) });
  }
  revalidatePath(shelfBase(token));
  redirect(`${shelfBase(token)}?forgot=1`);
}

const sizesSchema = z.object({
  bcdSize: z.string().trim().max(20),
  wetsuitSize: z.string().trim().max(20),
  bootSize: z.string().trim().max(20),
  finSize: z.string().trim().max(20),
});

/**
 * The four sizes, written to the same `rental_fit_profiles` row the rental
 * ticket reads — never a shadow copy. Which pieces the shop supplies is left
 * exactly as it was; see `saveRentalFitSizes`.
 */
export async function saveShelfSizesAction(token: string, formData: FormData): Promise<void> {
  const ctx = await contextFor(token);
  if (!ctx) redirect(shelfBase(token));
  const parsed = sizesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${shelfBase(token)}?error=sizes`);
  const saved = await saveRentalFitSizes(ctx.db, {
    shopId: ctx.shopId,
    personId: ctx.personId,
    ...parsed.data,
  });
  if (!saved) redirect(`${shelfBase(token)}?error=sizes`);
  revalidatePath(shelfBase(token));
  redirect(`${shelfBase(token)}?saved=sizes`);
}

/**
 * The same two bounds the staff record's own form holds this field to
 * (`personSchema`, `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`) —
 * one column, one shape, whoever is typing into it.
 *
 * The refinement is this form's own: a submission with both boxes empty is
 * refused **here**, at the boundary, rather than reaching a writer that would
 * decline it anyway. A field a diver can neither fill nor clear is a form that
 * answers "nothing happened" with a red line, and stating the rule where the
 * shape is stated is what stops the next reader inferring it from a `return
 * false` two modules away.
 *
 * One box filled and the other empty is refused for a different reason, and
 * with different words: the pair is what reaches a person, and half of it
 * written over a stored contact is a new name wearing the old number
 * (`readEmergencyContact`).
 */
const contactSchema = z
  .object({
    emergencyContactName: z.string().trim().max(120),
    emergencyContactPhone: z.string().trim().max(40),
  })
  .refine((value) => value.emergencyContactName || value.emergencyContactPhone);

/**
 * The diver's own emergency contact, on their own record.
 *
 * **Both ids come from the verified token**, like every action in this file —
 * the form carries neither, so a forged body cannot name somebody else's
 * record — and `savePersonEmergencyContact` filters on the pair again before it
 * writes, which is what stops a person id from one shop landing on another's.
 */
export async function saveShelfEmergencyContactAction(
  token: string,
  formData: FormData,
): Promise<void> {
  const ctx = await contextFor(token);
  if (!ctx) redirect(shelfBase(token));
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${shelfBase(token)}?error=contact`);
  const submitted = readEmergencyContact({
    name: parsed.data.emergencyContactName,
    phone: parsed.data.emergencyContactPhone,
  });
  if (submitted.kind === "half") redirect(`${shelfBase(token)}?error=contact-pair`);
  const saved = await savePersonEmergencyContact(ctx.db, {
    shopId: ctx.shopId,
    personId: ctx.personId,
    name: parsed.data.emergencyContactName,
    phone: parsed.data.emergencyContactPhone,
  });
  if (!saved) redirect(`${shelfBase(token)}?error=contact`);
  revalidatePath(shelfBase(token));
  redirect(`${shelfBase(token)}?saved=contact`);
}

/**
 * **The thread door.** Mints a readiness capability for a seat this diver
 * holds and sends them to it.
 *
 * A POST rather than a link, because it writes: a `/ready` capability is a
 * credential, and minting one on every render of a page a diver keeps open
 * would churn the twenty-row live set `issueBookingCapability` maintains. The
 * booking is re-checked against the token's own person and shop, so a forged
 * body naming somebody else's seat mints nothing.
 */
export async function openThreadAction(token: string, bookingId: string): Promise<void> {
  const ctx = await contextFor(token);
  if (!ctx) redirect(shelfBase(token));
  const [seat] = await ctx.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), liveTrip()))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, ctx.shopId),
        eq(bookings.personId, ctx.personId),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
      ),
    )
    .limit(1);
  if (!seat) redirect(shelfBase(token));
  const issued = await issueBookingCapability(ctx.db, {
    shopId: ctx.shopId,
    bookingId: seat.id,
    purpose: "readiness",
  });
  if (!issued) redirect(shelfBase(token));
  redirect(readinessLinkPath(issued.token));
}

/**
 * **The same-boat door**, with the diver already known.
 *
 * Mints a booking handoff off this diver's most recent live seat and hangs it
 * on the trip page's URL, which is what makes `KnownDiverPanel` render there
 * (ADR 20260906-before-you-ask, decision 3). A handoff is safe to mint from
 * here for the reason the recap is not allowed to: a shelf token is stored and
 * revocable, so the shop can kill it, where a signed 180-day recap link cannot
 * be killed at all.
 *
 * With no seat to mint from — a diver whose only visits were walk-ins — the
 * door still opens, on the cold form. A trip page is public.
 */
export async function openSameBoatAction(token: string, tripId: string): Promise<void> {
  const ctx = await contextFor(token);
  if (!ctx) redirect(shelfBase(token));
  const [shop] = await ctx.db
    .select({ slug: shops.slug })
    .from(shops)
    .where(eq(shops.id, ctx.shopId))
    .limit(1);
  if (!shop) redirect(shelfBase(token));

  const [trip] = await ctx.db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.shopId, ctx.shopId),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!trip) redirect(shelfBase(token));

  const [seat] = await ctx.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), liveTrip()))
    .where(
      and(
        eq(bookings.shopId, ctx.shopId),
        eq(bookings.personId, ctx.personId),
        ne(bookings.status, "cancelled"),
      ),
    )
    // The **most recent** seat, not the oldest: `readKnownDiver` resolves the
    // person from the booking and reads their contact fields off `people`, so
    // any seat would do — but a handoff minted off a diver's first-ever visit
    // is the wrong row to be minting credentials from three seasons later.
    .orderBy(desc(trips.startsAt))
    .limit(1);

  const tripPath = publicTripPath(shop.slug, trip.id);
  if (!seat) redirect(`${tripPath}#book`);
  const handoff = await issueBookingHandoff(ctx.db, {
    shopId: ctx.shopId,
    bookingId: seat.id,
  });
  // **`handoffHref`, never a hand-built query string.** What travels is a
  // ten-minute, single-use, opaque capability — never the diver's email or
  // phone, which the trip page resolves server-side from it (`readKnownDiver`).
  // Going through the one builder is what keeps that parameter named
  // `HANDOFF_QUERY_PARAM`, which is the name `src/lib/capability-urls.ts`
  // redacts from every log and beacon; a second spelling would travel
  // unredacted.
  redirect(handoff ? `${handoffHref(tripPath, handoff.token)}#book` : `${tripPath}#book`);
}
