import { and, asc, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { issueBookingHandoff } from "@/db/booking-handoff";
import type { AppDb } from "@/db/client";
import { askAnytime } from "@/db/interests";
import { bookings, people, rentalFitProfiles, trips } from "@/db/schema";
import { liveTrip, seatNotCancelled } from "@/db/trips";
import { handoffHref } from "@/lib/booking-handoff";
import { DAY_MS } from "@/lib/clock";
import { diveDeclarationSchema, toDiveDeclaration } from "@/lib/dive-declaration";
import { publicTripPath } from "@/lib/public-routes";
import { FactRefused } from "./refusal";

/** One of the shop's live people, by email, or the refusal that names who is missing. */
async function personByEmail(db: AppDb, shopId: string, email: string, missing: string) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        eq(people.email, email.toLowerCase()),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!person) throw new FactRefused(missing, 404);
  return person;
}

export const returningDiverArgs = z.object({ email: z.string().trim().email() }).strict();

/** The staffer who kept the fit — the seeded divemaster, by name inside this tenant. */
const KEEPER_FULL_NAME = "Keiko Tanaka";
/**
 * Long enough before any booking a spec can make that the fit is genuinely last
 * season's. The page compares against `bookings.created_at`, which carries the
 * database's `now()` rather than the frozen clock; the margin is what makes the
 * two agree here.
 */
const STATED_DAYS_AGO = 60;
/** Recent enough that "after your last trip" is a trip the diver remembers. */
const CONFIRMED_DAYS_AGO = 6;

/**
 * **A returning diver** (`returningDiver`), the state the "Anything changed?"
 * step exists for (ADR 20260904-reef-all-the-way-down, D15), plus the fit
 * confirmation D14's recall line reads. No form can reach either: the sizes
 * have to predate the booking, and the confirmation is written by the evening
 * leftover row. It writes only what a real day would have left: sizes stated
 * on a previous trip, a confirmation by a staffer of this shop's own, and an
 * emergency contact on file (which is what makes "Not on file" its own state).
 */
export async function makeADiverReturning(
  db: AppDb,
  shopId: string,
  { email }: z.output<typeof returningDiverArgs>,
  now: Date,
) {
  const diver = await personByEmail(db, shopId, email, "diver_not_found");
  const [keeper] = await db
    .select({ id: people.id })
    .from(people)
    // diveday:allow-deleted-people: an e2e seed finds the divers it just seeded; nobody is removed yet.
    .where(and(eq(people.shopId, shopId), eq(people.fullName, KEEPER_FULL_NAME)))
    .limit(1);
  if (!keeper) throw new FactRefused("keeper_not_found", 404);

  const fit = {
    rentsBcd: true,
    rentsRegulator: true,
    rentsWetsuit: true,
    rentsMask: true,
    rentsFins: true,
    rentsWeights: true,
    rentsDiveComputer: false,
    rentsGopro: false,
    rentsDrysuit: false,
    rentsHood: false,
    rentsGloves: false,
    rentsTorch: false,
    rentsSmb: false,
    bcdSize: "M",
    wetsuitSize: "3 mm / M",
    bootSize: "9",
    finSize: "9",
    weightPreference: "16 lb",
    // The whole point: stated before the seat this spec is about was booked.
    fitStatedAt: new Date(now.getTime() - STATED_DAYS_AGO * DAY_MS),
    fitConfirmedAt: new Date(now.getTime() - CONFIRMED_DAYS_AGO * DAY_MS),
    fitConfirmedBy: keeper.id,
    fitConfirmedItem: "bcd" as const,
    updatedAt: now,
  };
  await db
    .insert(rentalFitProfiles)
    .values({ shopId, personId: diver.id, ...fit })
    .onConflictDoUpdate({
      target: [rentalFitProfiles.shopId, rentalFitProfiles.personId],
      set: fit,
    });
  await db
    .update(people)
    .set({
      emergencyContactName: "Marisol Vega (sister)",
      emergencyContactPhone: "+1-305-555-0148",
    })
    .where(and(eq(people.id, diver.id), eq(people.shopId, shopId)));
}

export const bookingHandoffArgs = z.object({ email: z.string().trim().email() }).strict();

/**
 * **The booking page as a known diver reaches it** (`bookingHandoff`, ADR
 * 20260906-before-you-ask, decision 3): a ten-minute handoff minted from the
 * diver's own latest booking, onto the shop's next public departure that is not
 * that booking's. In the product only `/ready/<token>` mints one, from the
 * thread's next-dive card; this writes only the `booking_capabilities` row the
 * thread would have, and answers the href.
 */
export async function handADiverTheNextDeparture(
  db: AppDb,
  shop: { id: string; slug: string },
  { email }: z.output<typeof bookingHandoffArgs>,
  now: Date,
) {
  const [own] = await db
    .select({ bookingId: bookings.id, tripId: bookings.tripId })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(people.email, email.toLowerCase()),
        isNull(people.deletedAt),
        seatNotCancelled,
      ),
    )
    .orderBy(desc(trips.startsAt))
    .limit(1);
  if (!own) throw new FactRefused("booking_not_found", 404);
  const [next] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shop.id),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        ne(trips.id, own.tripId),
        gte(trips.startsAt, now),
        liveTrip(),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!next) throw new FactRefused("no_next_departure", 404);
  const issued = await issueBookingHandoff(db, { shopId: shop.id, bookingId: own.bookingId });
  if (!issued) throw new FactRefused("handoff_refused");
  return { href: handoffHref(publicTripPath(shop.slug, next.id), issued.token) };
}

export const lastMinuteInterestArgs = z
  .object({
    fullName: z.string().trim().min(1),
    email: z.string().trim().email(),
    certificationLevel: z.string().optional(),
    availableFrom: z.string().optional(),
  })
  .strict();

/**
 * **One joiner on the last-minute list** (`lastMinuteInterest`), through the
 * same `askAnytime` write the public form's action makes, declaration included,
 * so a spec about the deal panel or the diver record starts from the list
 * rather than typing a sign-up. `e2e/last-minute-fill.spec.ts` keeps one test
 * that signs up through the real form.
 */
export async function putSomebodyOnTheLastMinuteList(
  db: AppDb,
  shopId: string,
  args: z.output<typeof lastMinuteInterestArgs>,
) {
  const declaration = diveDeclarationSchema.safeParse({
    certificationLevel: args.certificationLevel,
  });
  if (!declaration.success) throw new FactRefused("invalid_declaration");
  await askAnytime(db, {
    shopId,
    fullName: args.fullName,
    email: args.email,
    availableFrom: args.availableFrom,
    declaration: toDiveDeclaration(declaration.data),
  });
}

export const pinAddedDateArgs = z.object({ fullName: z.string().trim().min(1).max(200) }).strict();

/**
 * **The shop's live records of one name, added at the app's clock**
 * (`pinAddedDate`, issue #2297), so a capture that prints a record's "Added"
 * date stops changing every day. A Drizzle insert stamps `created_at` from the
 * app clock (`appNowTimestamp`, issue #2538), but the seed's own rows were
 * stamped when the e2e database was built, and the merge preview prints one of
 * each.
 */
export async function pinWhenARecordWasAdded(
  db: AppDb,
  shopId: string,
  { fullName }: z.output<typeof pinAddedDateArgs>,
  now: Date,
) {
  const pinned = await db
    .update(people)
    .set({ createdAt: now })
    .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName), isNull(people.deletedAt)))
    .returning({ id: people.id });
  return { pinned: pinned.length };
}
