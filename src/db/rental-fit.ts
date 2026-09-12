import { and, asc, eq, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { PrepDiver } from "@/lib/dive-prep";
import {
  NOTHING_RENTED,
  offeredRentalFitFields,
  RENTABLE_ITEMS,
  type RentalFitField,
  SIZED_RENTAL_FIT_COLUMN,
  type SizedRentalKind,
} from "@/lib/rentals";
import type { AppDb } from "./client";
import { verifiedNitroxPersonIds } from "./nitrox";
import {
  bookings,
  diveSupportNeeds,
  people,
  type rentalFitItem,
  rentalFitProfiles,
  shops,
} from "./schema";
import { SUPPORT_NEEDS_COLUMNS } from "./support-needs";

export type RentalFitInput = {
  shopId: string;
  personId: string;
  /**
   * Which pieces the diver rents — **optional, like the sizes below and for the
   * same reason** (issue #1755). A caller with nothing to say about an item
   * omits it; one that derives all eleven from a form is narrowed to the shop's
   * current catalog by `flagUpdates` below, which is where that rule and the
   * dropped-then-re-added question are written up.
   */
  rentsBcd?: boolean;
  rentsRegulator?: boolean;
  rentsWetsuit?: boolean;
  rentsMaskFins?: boolean;
  rentsWeights?: boolean;
  rentsDiveComputer?: boolean;
  rentsGopro?: boolean;
  rentsDrysuit?: boolean;
  rentsHoodGloves?: boolean;
  rentsTorch?: boolean;
  rentsSmb?: boolean;
  bcdSize?: string;
  wetsuitSize?: string;
  drysuitSize?: string;
  bootSize?: string;
  finSize?: string;
  weightPreference?: string;
  note?: string;
};

function optional(value: string | undefined) {
  return value?.trim() || null;
}

/**
 * **The `rents_*` columns this shop's catalog has an answer for**; the rest
 * stay exactly as they are, which is the mirror of the absent-size rule below
 * (issue #1755).
 *
 * An item a shop has dropped from its catalog renders no checkbox on any of the
 * four fit surfaces, and an unchecked HTML checkbox posts nothing — so every
 * caller derives `false` for it from a form that never asked. Writing that
 * turned `rents_drysuit` off on the next save of a diver's fit, by the diver on
 * `/ready` or by a staffer nudging a boot size on the record, while
 * `drysuit_size` was preserved by the very defence protecting sizes: the suit
 * left that diver's packing list and the size sat behind it recording a fit
 * nobody would act on.
 *
 * The offered set is re-derived **here**, not asked of the caller, for the
 * reason issue #1754 is filed about its twin: a rule the forms each have to
 * remember is a rule one of them forgets, and there are four of them. It is the
 * same shape `setBookingNitrox` already keeps in `src/db/nitrox.ts`, which
 * re-reads the catalog rather than trusting a post that claims a fill the shop
 * does not sell.
 *
 * **A shop that drops an item and later re-adds it gets the diver's old answer
 * back**, deliberately. It is still their answer, nobody retracted it, and the
 * alternative is a shop's catalog edit quietly speaking for a diver who was
 * never asked. Clearing a stored fit when an item leaves the catalog is a
 * defensible thing to want, but it belongs in the settings change where a
 * staffer is present to be told, not in a drive-by on the next diver save.
 */
function flagUpdates(
  input: RentalFitInput,
  offered: Set<RentalFitField>,
): Partial<Record<RentalFitField, boolean>> {
  const flags: Partial<Record<RentalFitField, boolean>> = {};
  for (const item of RENTABLE_ITEMS) {
    const value = input[item.field];
    if (value !== undefined && offered.has(item.field)) flags[item.field] = value;
  }
  return flags;
}

/**
 * The shop's catalog and whether this diver has a **stated fit** on file — the
 * two facts {@link flagUpdates} needs, in one round trip, or **null when the
 * shop itself cannot be read**.
 *
 * A row with `fit_stated_at` null exists for something other than a fit: today
 * that is `saveRentalFitNote`, which creates one for a diver who has only left
 * the crew a note. Its `rents_*` columns are still at their schema defaults,
 * five of which are **true**, and nothing reads them while the discriminator is
 * null (`schema.ts`, `rental_fit_profiles.fit_stated_at`). So "leave the column
 * alone" has to mean "leave the diver's own prior answer alone" — where there
 * has never been an answer, an un-offered item must land `false` rather than
 * inherit a default that would pack a BCD, a regulator, a wetsuit, a mask, fins
 * and weights nobody asked for.
 *
 * **A missing shop row is a refusal, not an empty catalog** (`dive-domain-expert`
 * review). `?? []` on the column is right — a shop really can rent nothing —
 * but reading *no row* the same way turns a save into a silent lie: every flag
 * would go to `false` on a brand-new profile and the caller would be told it
 * saved. `saveRentalFit` already answers an unknown person with null, and a
 * shop whose catalog cannot be read deserves the same answer.
 */
async function fitWritingContext(db: AppDb, shopId: string, personId: string) {
  const [[shop], [profile]] = await Promise.all([
    db.select({ rentalItems: shops.rentalItems }).from(shops).where(eq(shops.id, shopId)).limit(1),
    db
      .select({ fitStatedAt: rentalFitProfiles.fitStatedAt })
      .from(rentalFitProfiles)
      .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)))
      .limit(1),
  ]);
  if (!shop) return null;
  return {
    offered: offeredRentalFitFields(shop.rentalItems ?? []),
    statedBefore: Boolean(profile?.fitStatedAt),
  };
}

/** The size columns the caller actually named, trimmed; the rest stay as they are. */
function sizeUpdates(input: RentalFitInput) {
  const sizes = {
    bcdSize: input.bcdSize,
    wetsuitSize: input.wetsuitSize,
    drysuitSize: input.drysuitSize,
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

  const context = await fitWritingContext(db, input.shopId, input.personId);
  if (!context) return null;
  const { offered, statedBefore } = context;
  const values = {
    // Only the pieces this shop currently rents are written; an item its
    // catalog has dropped keeps whatever the diver last said (`flagUpdates`,
    // issue #1755 -- the mirror of the absent-size rule below).
    //
    // `NOTHING_RENTED` underneath it is for a row that has never stated a fit:
    // a column nobody has answered must not arrive as its `default(true)`,
    // which would be six unasked-for pieces on the packing list
    // (`fitWritingContext`).
    ...(statedBefore ? {} : NOTHING_RENTED),
    ...flagUpdates(input, offered),
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
    // **The row this writer creates is the one every later writer inherits**,
    // so it starts claiming nothing (`NOTHING_RENTED`, `security-reviewer`
    // issue #1755). Five `rents_*` columns default to `true`, and while
    // `fit_stated_at` is null nothing reads them -- but the next writer to
    // stamp it hands those defaults to the packing list, which is how a note
    // about a titanium hip turned into a BCD, a regulator, a wetsuit, a mask,
    // fins and weights nobody ticked. Laid only on the insert: an existing
    // profile's own answers are the diver's and are never touched here.
    .values({ shopId: input.shopId, personId: input.personId, ...NOTHING_RENTED, ...values })
    .onConflictDoUpdate({
      target: [rentalFitProfiles.shopId, rentalFitProfiles.personId],
      set: values,
    })
    .returning();
  return profile ?? null;
}

/**
 * **The four sizes on their own** — what the diver's shelf writes.
 *
 * The shelf shows the sizes the shop has and lets the diver correct them, and
 * that is the whole of what it may write: which pieces the shop supplies is the
 * shop's answer, not the diver's, and the shelf has no checkbox to answer it
 * with. Same shape as `saveRentalFitNote` for the same reason — one form, one
 * set of columns, and nothing a diver did not touch.
 *
 * `fit_stated_at` **is** set here, unlike the note writer: four sizes typed by
 * the diver are a stated fit, which is exactly what the packing list should
 * read them as. An emptied box clears that size, which is the diver saying they
 * do not know it rather than a value to keep.
 *
 * Same tenant proof as its two siblings: a copied URL cannot write a size into
 * another shop's record.
 */
export async function saveRentalFitSizes(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    bcdSize: string;
    wetsuitSize: string;
    bootSize: string;
    finSize: string;
  },
) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;

  const values = {
    bcdSize: optional(input.bcdSize),
    wetsuitSize: optional(input.wetsuitSize),
    bootSize: optional(input.bootSize),
    finSize: optional(input.finSize),
    fitStatedAt: nowDate(),
    updatedAt: nowDate(),
  };
  const [profile] = await db
    .insert(rentalFitProfiles)
    // The shelf has no checkbox, so the profile it creates claims nothing
    // (`NOTHING_RENTED`, `security-reviewer` issue #1755). This writer stamps
    // `fit_stated_at`, which is what makes the five `default(true)` columns
    // readable, so without the baseline a diver correcting one size on their
    // own phone stated a fit claiming six pieces their shop may not even rent.
    // On the insert only: `set:` stays four sizes and the clock, so nothing a
    // diver did not touch is rewritten.
    .values({ shopId: input.shopId, personId: input.personId, ...NOTHING_RENTED, ...values })
    .onConflictDoUpdate({
      target: [rentalFitProfiles.shopId, rentalFitProfiles.personId],
      set: values,
    })
    .returning();
  return profile ?? null;
}

/**
 * What a fit-keep can answer. Named so the one surface that has to find words
 * for every refusal — the shop home, where the tap lands — can type its notice
 * map against this union with `NoticeCodeOf` rather than rediscovering it by
 * reading this function. Both refusals used to reach that page and render
 * nothing at all.
 */
export type ConfirmRentalFitOutcome = "saved" | "unknown_person" | "invalid";

/**
 * **Keep the size that actually went out** (issue #1174, delight report D14).
 *
 * The evening's one-tap answer to "Hugo's BCD went out as L — keep that as the
 * fit?", and the only writer of the `fit_confirmed_*` trio. It writes the one
 * size column for that kind and stamps `fit_stated_at` — a size a human
 * confirmed *is* a stated fit — plus the trio, because a fit somebody checked
 * against a real return is a different fact from one somebody typed.
 *
 * **The item is stamped, not just the clock**, because the diver's own thread
 * has to name the piece: "Keiko Tanaka kept your BCD at M after your last
 * trip". `fitConfirmationForDiver` below refuses to render without all three,
 * so a stamp with no item would silently cost that sentence.
 *
 * Slices 16g and 16h each invented this write independently — 16g as a
 * stamp-only `confirmRentalFit` with no caller, 16h as this one — and the
 * stamp-only shape is the wrong one for the button that uses it: "keep that as
 * the fit" that edits no size does nothing at all. One function, and the columns
 * are 16g's three rather than 16h's two.
 *
 * **`needs_staff_fit_at` is conspicuously absent and must stay absent.** A size
 * edit never clears that flag (the column's own comment in schema.ts): a stale
 * flag costs one extra look at the counter, and a wrongly-cleared one puts a
 * diver in gear nobody checked.
 *
 * Codes, never sentences — the UI picks the words.
 */
export async function confirmRentalFitSize(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    kind: SizedRentalKind;
    size: string;
    /** The staff member whose call it was. Attribution, not authorization. */
    confirmedByPersonId: string;
    now?: Date;
  },
): Promise<ConfirmRentalFitOutcome> {
  const size = input.size.trim();
  if (!size) return "invalid";
  // The same tenant proof `saveRentalFit` makes: a copied id must not write a
  // fit into another shop's record.
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return "unknown_person";

  const at = input.now ?? nowDate();
  const values = {
    [SIZED_RENTAL_FIT_COLUMN[input.kind]]: size,
    fitStatedAt: at,
    fitConfirmedAt: at,
    fitConfirmedBy: input.confirmedByPersonId,
    fitConfirmedItem: input.kind,
    updatedAt: at,
  };
  await db
    .insert(rentalFitProfiles)
    // Same baseline as its two siblings above, for the same reason: the
    // evening's one tap stamps `fit_stated_at`, so a diver with no fit on file
    // would get a stated fit claiming the five `default(true)` pieces
    // alongside the one size a staffer actually confirmed (`NOTHING_RENTED`,
    // `security-reviewer` issue #1755). Insert path only.
    .values({ shopId: input.shopId, personId: input.personId, ...NOTHING_RENTED, ...values })
    .onConflictDoUpdate({
      target: [rentalFitProfiles.shopId, rentalFitProfiles.personId],
      set: values,
    });
  return "saved";
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

/**
 * Which piece of a fit a staffer kept — the `rental_fit_item` enum, whose values
 * are `SIZED_RENTAL_KINDS` exactly. Two names for one set, because the enum is a
 * stored column and the const is what the fit editor and the evening both read;
 * `confirmRentalFitSize` passes a `SizedRentalKind` straight into it.
 */
export type RentalFitItem = (typeof rentalFitItem.enumValues)[number];

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
  rentsDrysuit: boolean;
  rentsHoodGloves: boolean;
  rentsTorch: boolean;
  rentsSmb: boolean;
  bcdSize: string | null;
  wetsuitSize: string | null;
  /**
   * Crosses the boundary because the diver is the one who states it: the
   * drysuit size is their own answer on their own form (issue 1414), the same
   * standing as the wetsuit size above it — not something the shop wrote
   * about them, which is what this projection exists to hold back.
   */
  drysuitSize: string | null;
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
    rentsDrysuit: profile.rentsDrysuit,
    rentsHoodGloves: profile.rentsHoodGloves,
    rentsTorch: profile.rentsTorch,
    rentsSmb: profile.rentsSmb,
    bcdSize: profile.bcdSize,
    wetsuitSize: profile.wetsuitSize,
    drysuitSize: profile.drysuitSize,
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
