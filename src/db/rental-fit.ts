import { and, asc, eq, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { PrepDiver } from "@/lib/dive-prep";
import type { AppDb } from "./client";
import { verifiedNitroxPersonIds } from "./nitrox";
import {
  bookings,
  diveSupportNeeds,
  people,
  type rentalFitItem,
  rentalFitProfiles,
} from "./schema";
import { SUPPORT_NEEDS_COLUMNS } from "./support-needs";

export type RentalFitInput = {
  shopId: string;
  personId: string;
  rentsBcd: boolean;
  rentsRegulator: boolean;
  rentsWetsuit: boolean;
  rentsMaskFins: boolean;
  rentsWeights: boolean;
  rentsDiveComputer: boolean;
  rentsGopro: boolean;
  bcdSize?: string;
  wetsuitSize?: string;
  bootSize?: string;
  finSize?: string;
  weightPreference?: string;
  note?: string;
};

function optional(value: string | undefined) {
  return value?.trim() || null;
}

/** The size columns the caller actually named, trimmed; the rest stay as they are. */
function sizeUpdates(input: RentalFitInput) {
  const sizes = {
    bcdSize: input.bcdSize,
    wetsuitSize: input.wetsuitSize,
    bootSize: input.bootSize,
    finSize: input.finSize,
    weightPreference: input.weightPreference,
  };
  return Object.fromEntries(
    Object.entries(sizes)
      .filter(([, value]) => value !== undefined)
      .map(([column, value]) => [column, optional(value)]),
  );
}

/**
 * A fit is a living preference, not evidence: staff and divers both correct it
 * as sizes change, so it upserts rather than versioning. The person lookup
 * keeps a copied URL from writing a fit into another shop's tenant.
 */
export async function saveRentalFit(db: AppDb, input: RentalFitInput) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;

  const values = {
    rentsBcd: input.rentsBcd,
    rentsRegulator: input.rentsRegulator,
    rentsWetsuit: input.rentsWetsuit,
    rentsMaskFins: input.rentsMaskFins,
    rentsWeights: input.rentsWeights,
    rentsDiveComputer: input.rentsDiveComputer,
    rentsGopro: input.rentsGopro,
    // Each size is written only when the caller actually carried it -- the
    // same rule as `note` below, and for the same reason. The diver record's
    // form renders a size box only for an item the shop's catalog currently
    // offers, so a shop that has turned weights off posts no
    // `weightPreference` at all. Writing `null` for an absent key would erase
    // a size the diver already gave the moment the shop put the item back
    // (issue #1062); refusing the save instead, which is what a required
    // field did, left that shop unable to save any fit at all.
    ...sizeUpdates(input),
    // This writer *is* the fit being stated — by the diver's gear form or by
    // staff editing it. `saveRentalFitNote` deliberately never sets it, which
    // is what keeps a note-only row off the packing list (see the column's own
    // comment in schema.ts).
    fitStatedAt: nowDate(),
    updatedAt: nowDate(),
  };
  // The note is the diver's own words to the crew ("titanium hip, I run heavy").
  // Only a form that actually carries it may write it — otherwise staff nudging
  // a boot size would silently delete something nobody can recover.
  const withNote = input.note === undefined ? values : { ...values, note: optional(input.note) };
  const [profile] = await db
    .insert(rentalFitProfiles)
    .values({ shopId: input.shopId, personId: input.personId, ...withNote })
    .onConflictDoUpdate({
      target: [rentalFitProfiles.shopId, rentalFitProfiles.personId],
      set: withNote,
    })
    .returning();
  return profile ?? null;
}

/**
 * The diver's own words to the crew ("titanium hip, I run heavy"), saved on
 * their own.
 *
 * The note used to be the last field of the rental-fit form, so it could only
 * be written by a save that also carried every size and checkbox. It is its own
 * question on `/ready` now (issue 627), and a diver answering it must not
 * blank the sizes they set last week — so this writes the note column and the
 * clock, and nothing else. The `optional()` trim means an emptied box clears
 * the note rather than storing whitespace, which is the diver taking their
 * words back.
 *
 * Same tenant proof as `saveRentalFit` above: a copied URL cannot write a note
 * into another shop's record.
 */
export async function saveRentalFitNote(
  db: AppDb,
  input: { shopId: string; personId: string; note: string },
) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;

  // `fitStatedAt` is conspicuously absent, and must stay absent: it is the one
  // thing separating "this diver stated a fit" from "this row exists because
  // they left a note". Setting it here would put six unasked-for pieces on the
  // boat's packing list (schema.ts, `fit_stated_at`).
  const values = { note: optional(input.note), updatedAt: nowDate() };
  const [profile] = await db
    .insert(rentalFitProfiles)
    .values({ shopId: input.shopId, personId: input.personId, ...values })
    .onConflictDoUpdate({
      target: [rentalFitProfiles.shopId, rentalFitProfiles.personId],
      set: values,
    })
    .returning();
  return profile ?? null;
}

/**
 * The safe fallback when a requested size isn't in stock (H-06): flag the diver
 * for hands-on fitting at check-in rather than packing a size nobody chose.
 * Open to any staff member — it escalates to a person, it never overwrites what
 * the diver asked for, so it is the day's work rather than an override
 * (`canOverrideGearRequest`). Returns null when the diver has no fit on file
 * yet; there is nothing to flag against, and the prep list already names them
 * under `diversWithIncompleteFit`.
 */
export async function setNeedsStaffFit(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    needed: boolean;
    note?: string;
    /** The staff member raising or clearing it — attribution, not authorization. */
    byPersonId?: string;
  },
) {
  const [profile] = await db
    .update(rentalFitProfiles)
    .set({
      needsStaffFitAt: input.needed ? nowDate() : null,
      needsStaffFitNote: input.needed ? optional(input.note) : null,
      needsStaffFitBy: input.needed ? (input.byPersonId ?? null) : null,
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(rentalFitProfiles.shopId, input.shopId),
        eq(rentalFitProfiles.personId, input.personId),
      ),
    )
    .returning();
  return profile ?? null;
}

/** Which piece of a fit a staffer kept — `rental_fit_item`, mirroring `SIZED_RENTAL_KINDS`. */
export type RentalFitItem = (typeof rentalFitItem.enumValues)[number];

/**
 * **A staffer kept this diver's fit** — the write behind D14's recall sentence
 * (ADR 20260904-reef-all-the-way-down).
 *
 * Confirming is *remembering*, not editing: this touches no size column, so
 * nothing a diver typed can be moved by a staffer tapping "Keep it" at the end
 * of a day. An UPDATE and never an upsert — a diver with no profile row has no
 * fit to confirm, which is the same refusal shape {@link setNeedsStaffFit}
 * makes and for the same reason.
 */
export async function confirmRentalFit(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    item: RentalFitItem;
    /** The staff member who kept it — attribution, not authorization. */
    byPersonId?: string;
  },
) {
  const [profile] = await db
    .update(rentalFitProfiles)
    .set({
      fitConfirmedAt: nowDate(),
      fitConfirmedBy: input.byPersonId ?? null,
      fitConfirmedItem: input.item,
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(rentalFitProfiles.shopId, input.shopId),
        eq(rentalFitProfiles.personId, input.personId),
      ),
    )
    .returning();
  return profile ?? null;
}

/**
 * **Who kept this diver's fit, which piece, and when** — or null.
 *
 * Null unless all three are on file, which is what makes the sentence it feeds
 * refuse to half-render. The commonest way to lose one is anonymization: the
 * erasure path nulls `fit_confirmed_by`, and a line reading "somebody kept your
 * BCD" would be worse than no line, so the whole thing ages out instead.
 *
 * Its own reader rather than a widening of {@link toDiverRentalFit}: that
 * projection is the browser boundary, and its docblock says the next column
 * added to this table must not cross it by default.
 */
export async function fitConfirmationForDiver(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<{ staffFullName: string; item: RentalFitItem; confirmedAt: Date } | null> {
  const [row] = await db
    .select({
      confirmedAt: rentalFitProfiles.fitConfirmedAt,
      item: rentalFitProfiles.fitConfirmedItem,
      staffFullName: people.fullName,
    })
    .from(rentalFitProfiles)
    .leftJoin(people, eq(people.id, rentalFitProfiles.fitConfirmedBy))
    .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)))
    .limit(1);
  if (!row?.confirmedAt || !row.item || !row.staffFullName) return null;
  return { staffFullName: row.staffFullName, item: row.item, confirmedAt: row.confirmedAt };
}

/**
 * The rental fit as the *diver* may see it — what they told the shop, and
 * nothing the shop wrote about them. `rental_fit_profiles` carries staff-only
 * columns (`needs_staff_fit_note` is crew shorthand about a person: "claims M,
 * is obviously XXL"), and the diver-facing surfaces that render this form are
 * client components on capability-token and public routes, so the whole row
 * would ship in the flight payload for anyone holding the link to read.
 *
 * Project explicitly rather than trusting `getRentalFit` to stay narrow: this
 * is the boundary, and the next column added to that table must not cross it
 * by default.
 */
export type DiverRentalFit = {
  rentsBcd: boolean;
  rentsRegulator: boolean;
  rentsWetsuit: boolean;
  rentsMaskFins: boolean;
  rentsWeights: boolean;
  rentsDiveComputer: boolean;
  rentsGopro: boolean;
  bcdSize: string | null;
  wetsuitSize: string | null;
  bootSize: string | null;
  finSize: string | null;
  weightPreference: string | null;
  /** The diver's own words to the crew — theirs to read and rewrite. */
  note: string | null;
  /**
   * Null when this row exists only to hold the note above, so the diver has
   * never actually answered the gear question. `/ready` reads it to decide
   * whether its "Gear and setup" row is done.
   */
  fitStatedAt: Date | null;
};

export function toDiverRentalFit(
  profile: Awaited<ReturnType<typeof getRentalFit>>,
): DiverRentalFit | null {
  if (!profile) return null;
  return {
    rentsBcd: profile.rentsBcd,
    rentsRegulator: profile.rentsRegulator,
    rentsWetsuit: profile.rentsWetsuit,
    rentsMaskFins: profile.rentsMaskFins,
    rentsWeights: profile.rentsWeights,
    rentsDiveComputer: profile.rentsDiveComputer,
    rentsGopro: profile.rentsGopro,
    bcdSize: profile.bcdSize,
    wetsuitSize: profile.wetsuitSize,
    bootSize: profile.bootSize,
    finSize: profile.finSize,
    weightPreference: profile.weightPreference,
    note: profile.note,
    fitStatedAt: profile.fitStatedAt,
  };
}

export async function getRentalFit(db: AppDb, shopId: string, personId: string) {
  const [profile] = await db
    .select()
    .from(rentalFitProfiles)
    .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)))
    .limit(1);
  return profile ?? null;
}

/**
 * Everything the prep checklist needs for one departure, in one read: the
 * active roster, each diver's fit, and — separately from the booking's own
 * request flag — whether their nitrox card is verified right now.
 */
export async function listTripPrepDivers(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<PrepDiver[]> {
  const rows = await db
    .select({
      booking: bookings,
      person: people,
      fit: rentalFitProfiles,
      // The projection, never the row. `PrepDiver.supportNeeds` is the eight
      // stated facts; the row also carries `id`, `shop_id`, `person_id` and two
      // housekeeping timestamps, and TypeScript's excess-property check does not
      // fire on a variable — so selecting the table would put internal ids on
      // every `PrepDiver` and one `"use client"` away from a browser payload
      // (`security-reviewer`, 2026-08-27).
      supportNeeds: SUPPORT_NEEDS_COLUMNS,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(
      rentalFitProfiles,
      and(
        eq(rentalFitProfiles.personId, bookings.personId),
        eq(rentalFitProfiles.shopId, bookings.shopId),
      ),
    )
    // Joined here rather than read separately: this function already takes one
    // round trip per roster and `getTripManifests` beside it fans out under a
    // strict no-`Promise.all`-on-a-transaction rule, so the cheapest place for
    // an optional one-row-per-person record is the join that is already
    // walking the roster.
    .leftJoin(
      diveSupportNeeds,
      and(
        eq(diveSupportNeeds.personId, bookings.personId),
        eq(diveSupportNeeds.shopId, bookings.shopId),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(people.fullName));

  const certified = await verifiedNitroxPersonIds(db, shopId);
  return rows.map((row) => ({
    bookingId: row.booking.id,
    personId: row.person.id,
    fullName: row.person.fullName,
    fit: row.fit,
    wantsNitrox: row.booking.wantsNitrox,
    hasVerifiedNitroxCard: certified.has(row.person.id),
    lastDivedBand: row.booking.lastDivedBand,
    hotelPickupLocation: row.booking.hotelPickupLocation,
    pickupTime: row.booking.pickupTime,
    // Every column of the projection is null when the outer join found no row,
    // so `statedAt` is the honest discriminator for "does this record exist".
    supportNeeds: row.supportNeeds?.statedAt ? row.supportNeeds : null,
  }));
}

/**
 * Fits for one trip's active roster, keyed by booking. Joined from bookings so
 * a caller that already has the roster does not have to wait for it first —
 * this reads in parallel with everything else a manifest needs.
 */
export async function rentalFitByBooking(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ bookingId: bookings.id, fit: rentalFitProfiles })
    .from(bookings)
    .leftJoin(
      rentalFitProfiles,
      and(
        eq(rentalFitProfiles.personId, bookings.personId),
        eq(rentalFitProfiles.shopId, bookings.shopId),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    );
  return new Map(rows.map((row) => [row.bookingId, row.fit]));
}
