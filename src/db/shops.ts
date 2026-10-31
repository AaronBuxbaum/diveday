import { and, eq, exists, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { cache } from "react";
import type { BrandBadgeCode, BrandDisplayFontCode } from "@/lib/brand";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DepthUnit } from "@/lib/depth-units";
import type { DeskPayment } from "@/lib/desk-payment";
import type { DockDayRhythm } from "@/lib/diver-planning";
import type { EmergencyReference } from "@/lib/emergency-reference";
import type { ShopCurrency } from "@/lib/money";
import type { NitroxFillMethod } from "@/lib/nitrox-fill";
import type { RentalPricing } from "@/lib/rentals";
import type { SeasonStart } from "@/lib/season";
import {
  SHOP_FEATURE_COLUMNS,
  type ShopFeature,
  type ShopFeatureColumn,
} from "@/lib/shop-features";
import type { ShoreAlertContact } from "@/lib/shore-alert-contact";
import type { TemperatureUnit } from "@/lib/temperature-units";
import type { CustomerRegulatorServiceMonths } from "@/lib/work-orders";
import type { AppDb, DbExecutor } from "./client";
import { courses, divePackages, orders, people, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The shop a public URL names. Its predicate is `eq(shops.slug, slug)` and
 * nothing else, and {@link shopIdBySlug} below must refuse exactly the same
 * rows: the edge asks the cheap question and the page asks the full one, so
 * the moment the two predicates disagree the edge 404s a storefront the page
 * would have rendered (ADR 20260912-the-public-namespace-refuses-at-the-edge).
 *
 * **A render reads the shop through `shopBySlugCached` (`./shops-cached`)
 * instead.** This one takes its executor, which is what the transactional
 * callers need and what makes it unmemoizable; see that reader's note.
 */
export async function getShopBySlug(db: AppDb, slug: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  return shop ?? null;
}

/**
 * "Is there a shop at this slug?" — the id alone, for the one caller that only
 * needs to know the answer is yes.
 *
 * `src/proxy.ts` runs this before the static shell of every `/s/**` document
 * request, so it reads one unique index and carries no row back. Same
 * predicate as {@link getShopBySlug} above, deliberately: see its note.
 */
export async function shopIdBySlug(db: AppDb, slug: string): Promise<string | null> {
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.slug, slug)).limit(1);
  return shop?.id ?? null;
}

/**
 * Every publicly-indexable shop, for the sitemap. Three conditions, and the
 * last two were added together by ADR 20260813-search-listing-is-a-choice.
 *
 * **Not a demo.** Including the canonical `blue-mantis` fixture the e2e/visual
 * fleet seeds (docs ADR 20260724-per-visitor-demo-shops) — a demo is a test
 * fixture a visitor spins up, not a real shop, and has no business in search
 * results.
 *
 * **Has not opted out.** A shop is listed by default, because being findable
 * is most of the reason to have a public schedule at all; a shop that would
 * rather not be says so in Settings and this is where that lands. The page
 * itself also emits `robots: noindex` — dropping out of the sitemap alone
 * would not un-index anything a crawler had already found.
 *
 * **Has published at least one departure.** A shop on its first afternoon has
 * a half-typed course and a test trip, and that is the version Google would
 * cache. Deliberately *not* "has a departure in the future": a shop between
 * seasons should stay indexed, because falling out of search is worse than
 * never entering it.
 */
export async function listShopsForSitemap(db: AppDb): Promise<{ slug: string; name: string }[]> {
  return db.select({ slug: shops.slug, name: shops.name }).from(shops).where(listedShopScope(db));
}

/**
 * The shops a diver can pick from on `/find-your-booking` (fourth review,
 * item 50): the same listed scope as the sitemap, so a shop that said no to
 * search is not named here either, with the town that tells two Reef Lines
 * apart. Name order, which is how a diver scans for theirs.
 */
export async function listShopsForDiverPicker(
  db: AppDb,
): Promise<{ slug: string; name: string; locality: string | null; region: string | null }[]> {
  return db
    .select({
      slug: shops.slug,
      name: shops.name,
      locality: shops.addressLocality,
      region: shops.addressRegion,
    })
    .from(shops)
    .where(listedShopScope(db))
    .orderBy(shops.name);
}

/**
 * **What "a listed shop" means, in one place** — the three conditions above,
 * as a `where` fragment. The sitemap, `llms.txt` and the diver's shop picker
 * all read through it,
 * so a shop that said no to search is absent from every public list DiveDay
 * publishes on its behalf, and a third reader cannot quietly widen the scope.
 */
export function listedShopScope(db: AppDb) {
  return and(
    eq(shops.isDemo, false),
    isNull(shops.searchListingOptOutAt),
    exists(
      db
        .select({ one: trips.id })
        .from(trips)
        .where(and(eq(trips.shopId, shops.id), eq(trips.status, "scheduled"), liveTrip())),
    ),
  );
}

export async function getShopById(db: AppDb, id: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, id)).limit(1);
  return shop ?? null;
}

/** The authenticated epoch used to reject pre-erasure offline roll-call notes. */
export async function getShopOfflineErasureEpoch(
  db: DbExecutor,
  shopId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ epoch: shops.offlineErasureEpoch })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return row?.epoch ?? null;
}

/**
 * {@link getShopById}, once per render per executor: for the staff gate
 * (`requireShopSurface`) and the shop home, which resolve the session's shop
 * by id in the same render (app audit 2026-10-07, item 2).
 *
 * Unlike {@link shopBySlugCached} this keeps the executor argument, and keys on
 * its identity: the pool is one object for the life of the process, so every
 * caller on it shares one read, while a transaction handle is a different key
 * and always reads its own snapshot rather than the pool's row. It takes the
 * executor because its callers already hold one - and because a reader that
 * reaches for `getDb()` itself is invisible to a test that hands its caller a
 * database.
 */
export const shopByIdCached = cache((db: AppDb, id: string) => getShopById(db, id));

/**
 * Replaces the shop-wide diver packing checklist after route-level validation,
 * and whether it also suggests a logbook (`shops.packing_logbook`).
 */
export async function setShopPackingList(
  db: AppDb,
  shopId: string,
  packingList: string[],
  packingLogbook: boolean,
) {
  const [shop] = await db
    .update(shops)
    .set({ packingList, packingLogbook })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Sets the zone every date and time in this shop is read and written in.
 *
 * Presentation *and* interpretation: a departure is stored as an instant, but
 * every form that sets one takes a wall-clock time and converts it through
 * this zone, and every surface converts back. Changing it therefore re-reads
 * existing departures at their new local times rather than moving them — which
 * is the right answer for the case this exists for (a shop that never touched
 * the sign-up picker and has been reading its own schedule in US Eastern).
 *
 * The caller validates the id against `isValidTimeZone` first; storing an id
 * this runtime doesn't know would make every formatter on every surface throw.
 */
export async function setShopTimezone(db: AppDb, shopId: string, timezone: string) {
  const [shop] = await db.update(shops).set({ timezone }).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/**
 * Where this shop's season starts — the denominator behind the home's one fact
 * of scale (ADR 20260904-reef-all-the-way-down, Budget rule 3). Validated by
 * `parseSeasonStart` and again by the table's own CHECK constraints.
 */
export async function setShopSeasonStart(db: AppDb, shopId: string, season: SeasonStart) {
  const [shop] = await db
    .update(shops)
    .set({ seasonStartMonth: season.month, seasonStartDay: season.day })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * The shop's "back on the water" date, or null to say nothing. The public
 * off-season line reads it only while the board is empty and the date is ahead
 * (`src/lib/off-season.ts`); the caller validates the date.
 */
export async function setShopReopensOn(db: AppDb, shopId: string, reopensOn: CalendarDate | null) {
  const [shop] = await db
    .update(shops)
    .set({ reopensOn })
    .where(eq(shops.id, shopId))
    .returning({ id: shops.id });
  return shop ?? null;
}

/**
 * The nightly roll's sweep of "Back on the water" dates that have passed.
 * `offSeason` already ignores a past date, so a diver sees nothing wrong, but
 * Settings would keep showing last season's date as if it were current. A date
 * is passed once it is before the shop's own today, in the shop's zone; the day
 * itself is not. Returns how many shops were cleared.
 */
export async function clearPassedReopensOn(db: AppDb, now: Date = nowDate()): Promise<number> {
  const dated = await db
    .select({ id: shops.id, reopensOn: shops.reopensOn, zone: shops.timezone })
    .from(shops)
    .where(isNotNull(shops.reopensOn));
  const passed = dated
    .filter(
      (shop) => shop.reopensOn !== null && shop.reopensOn < calendarDateInTimezone(now, shop.zone),
    )
    .map((shop) => shop.id);
  if (passed.length === 0) return 0;
  const cleared = await db
    .update(shops)
    .set({ reopensOn: null })
    .where(inArray(shops.id, passed))
    .returning({ id: shops.id });
  return cleared.length;
}

/** Turns Stripe Tax on or off for charges created after this setting is saved. */
export async function setShopTaxEnabled(db: AppDb, shopId: string, taxEnabled: boolean) {
  const [shop] = await db.update(shops).set({ taxEnabled }).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/** Saves the shop's named per-diver pass-through fee; null disables it. */
export async function setShopPassThroughFee(
  db: AppDb,
  shopId: string,
  fee: { name: string; amountCents: number } | null,
) {
  const [shop] = await db
    .update(shops)
    .set({ passThroughFee: fee })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * The shop's own emergency reference — the numbers a crew dials during, carried
 * into the offline manifest snapshot (issue #688). Replaced wholesale: it is one
 * card the shop retypes, not a set of independently-edited fields.
 */
export async function setShopEmergencyReference(
  db: AppDb,
  shopId: string,
  emergencyReference: EmergencyReference,
) {
  const [shop] = await db
    .update(shops)
    .set({ emergencyReference })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * **A human clears a flagged shop name** (issue #2450): the shop's mail goes
 * back to "{Shop} via DiveDay". Stamps the clearing rather than erasing the
 * flag, so a later rename that matches again (a newer flag) holds again. Null
 * for a shop that does not exist; clearing a shop that was never flagged is
 * harmless.
 */
export async function clearShopNameReview(db: AppDb, shopId: string, now: Date = nowDate()) {
  const [shop] = await db
    .update(shops)
    .set({ nameClearedAt: now })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * The shore contact's address, the consent recorded for it and whether its
 * inbox confirmed it (H-118), as `nextShoreAlertContact` decided them. The
 * columns move together; the table's checks refuse any other shape.
 */
export async function setShopShoreAlertContact(
  db: AppDb,
  shopId: string,
  contact: ShoreAlertContact,
) {
  const [shop] = await db
    .update(shops)
    .set({
      shoreAlertEmail: contact.email,
      shoreAlertConsentAt: contact.consentAt,
      shoreAlertConsentByPersonId: contact.consentByPersonId,
      shoreAlertConfirmedAt: contact.confirmedAt,
    })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Who recorded the shore contact's consent, as Settings says it ("Recorded
 * … by Dana"): the person's name as the row holds it today, inside this shop
 * only, removed staff included (the record stays theirs). Null when nobody is
 * on file or the id is not this shop's.
 */
export async function shoreAlertConsentRecorderName(
  db: AppDb,
  shop: { id: string; shoreAlertConsentByPersonId: string | null },
): Promise<string | null> {
  if (!shop.shoreAlertConsentByPersonId) return null;
  const [row] = await db
    .select({ name: people.fullName })
    .from(people)
    // diveday:allow-deleted-people: provenance names whoever recorded it.
    .where(and(eq(people.id, shop.shoreAlertConsentByPersonId), eq(people.shopId, shop.id)))
    .limit(1);
  return row?.name ?? null;
}

/**
 * Whether the shop has written a number down in its own currency yet — any
 * price it set, or a single order.
 *
 * The one question the currency select needs answering before a shop changes
 * it. Every `*_cents` column is an integer count of the **current** currency's
 * minor unit and nothing converts on a switch, so a shop moving `usd → mxn`
 * after pricing a $95 trip is left with a ninety-five *peso* trip (ADR
 * 20260731-shop-currency). Before any of that exists the change is free, and
 * saying so to a shop on its first afternoon would be noise (issue #712).
 *
 * **Every place the shop sets a price counts, not only `trips.price_cents`.**
 * The first version asked about priced trips and orders alone, which is the
 * shape a shop has on day one and stops being the shape it has by week two: a
 * shop that had priced its course catalogue, published a rental price list,
 * built a dive package or taken a deposit — but not yet a fun dive — was told
 * the switch was free, and the *silence* was the whole failure, since the
 * warning is the only thing standing between it and a catalogue of pesos
 * priced in dollars. Course, package, deposit and rental prices are all read
 * back to a diver at the point of sale, so each of them is exactly the money
 * the warning exists for.
 *
 * Percentage discounts (`shop_promo_codes`, `trip_last_minute_promos`) stay
 * out on purpose — a percentage means the same thing in any currency.
 *
 * Deliberately not a count: "how much money" is not the question, and a shop
 * with one priced trip is in exactly the same position as one with a thousand.
 */
export async function shopHasPricedRecords(db: AppDb, shopId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(
      and(
        eq(shops.id, shopId),
        or(
          exists(
            db
              .select({ one: trips.id })
              .from(trips)
              .where(
                and(
                  eq(trips.shopId, shopId),
                  or(gt(trips.priceCents, 0), gt(trips.depositCents, 0)),
                  liveTrip(),
                ),
              ),
          ),
          exists(
            db
              .select({ one: courses.id })
              .from(courses)
              .where(
                and(
                  eq(courses.shopId, shopId),
                  // Not narrowed to active courses: an inactive one keeps its
                  // price on the row and is one toggle from being sold again,
                  // so its number is still denominated in the old currency.
                  or(
                    gt(courses.priceCents, 0),
                    gt(courses.eLearningPriceCents, 0),
                    gt(courses.privatePriceCents, 0),
                  ),
                ),
              ),
          ),
          exists(
            db
              .select({ one: divePackages.id })
              .from(divePackages)
              .where(
                and(
                  eq(divePackages.shopId, shopId),
                  isNull(divePackages.deletedAt),
                  gt(divePackages.priceCents, 0),
                ),
              ),
          ),
          // The rental price list is a jsonb document rather than a table, so
          // it is asked in its own shape: a set price, a nitrox surcharge, or
          // any per-piece price at all.
          sql`(
            (${shops.rentalPricing}->>'setCents') is not null
            or (${shops.rentalPricing}->>'nitroxCents') is not null
            or coalesce(${shops.rentalPricing}->'perItemCents', '{}'::jsonb) <> '{}'::jsonb
          )`,
          // No `isNotNull(orders.id)` beside the tenant predicate — it is the
          // primary key, so it can only ever be true.
          exists(db.select({ one: orders.id }).from(orders).where(eq(orders.shopId, shopId))),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Stamp that the shop has looked at its units — what completes the setup
 * checklist's currency-and-depth step. Onboarding derives both from the
 * timezone, and a derived default nobody confirmed is the same failure with
 * extra steps (issue #712).
 */
export async function markShopUnitsConfirmed(db: AppDb, shopId: string, now = nowDate()) {
  const [shop] = await db
    .update(shops)
    .set({ unitsConfirmedAt: now })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Sets the shop's whole dock-day rhythm — the arrival call and the five minute
 * amounts the rest of the day is laid out from (src/lib/diver-planning.ts).
 *
 * All six together, never a field at a time: the beats before departure are
 * clamped against the arrival call, so saving a briefing without the call it
 * has to fit inside is how a shop ends up with a day that reads back
 * differently from the one they typed.
 */
export async function setShopDockDayRhythm(db: AppDb, shopId: string, rhythm: DockDayRhythm) {
  const [shop] = await db.update(shops).set(rhythm).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/**
 * Sets "Crew arrive N minutes before divers" (ux-delight sheet 2026-10-22,
 * item 2; H-149), or clears it with null so crew read the divers' time. The
 * action narrows the value through `parseCrewLeadMinutes`; the table's CHECK
 * holds the same bounds.
 */
export async function setShopCrewLead(db: AppDb, shopId: string, minutes: number | null) {
  const [shop] = await db
    .update(shops)
    .set({ crewLeadMinutes: minutes })
    .where(eq(shops.id, shopId))
    .returning({ id: shops.id, crewLeadMinutes: shops.crewLeadMinutes });
  return shop ?? null;
}

/**
 * Sets the shop's minimum turnaround between departures, in minutes (issue
 * #2141). Advice for the schedule builder's Move panel only; the route narrows
 * the value through `parseMinTurnaroundMinutes`, and the table's CHECK holds
 * the same bounds.
 */
export async function setShopMinTurnaround(db: AppDb, shopId: string, minutes: number) {
  const [shop] = await db
    .update(shops)
    .set({ minTurnaroundMinutes: minutes })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * How the shop takes money at the desk (fifth-loop ideas, item 21), or null
 * to say nothing. Read wherever a seat is "due at the shop".
 */
export async function setShopDeskPayment(
  db: AppDb,
  shopId: string,
  deskPayment: DeskPayment | null,
) {
  const [shop] = await db
    .update(shops)
    .set({ deskPayment })
    .where(eq(shops.id, shopId))
    .returning({ id: shops.id, deskPayment: shops.deskPayment });
  return shop ?? null;
}

/**
 * Sets the currency the shop displays and charges in. Unlike the depth unit
 * below, this is **not** lossless: every stored `*_cents` amount is an integer
 * count of the old currency's minor unit and no conversion happens here, so a
 * shop switching usd → jpy reinterprets a $130.00 trip as ¥13,000. Rows that
 * already settled (orders, checkouts, payments, refunds) carry their own
 * currency and are unaffected — it is the shop's own price list that needs
 * re-checking, which the settings copy says out loud.
 *
 * The route narrows the incoming value through `toShopCurrency` before calling
 * this, so an unsupported code can never be stored.
 */
export async function setShopCurrency(db: AppDb, shopId: string, currency: ShopCurrency) {
  const [shop] = await db.update(shops).set({ currency }).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/** Locks the shop row and reads its depth unit, for a switch that must not race another. */
export async function lockShopDepthUnit(tx: DbExecutor, shopId: string) {
  const [shop] = await tx
    .select({ depthUnit: shops.depthUnit })
    .from(shops)
    .where(eq(shops.id, shopId))
    .for("no key update");
  return shop?.depthUnit ?? null;
}

/**
 * Sets whether the shop reads depth in metres or feet. Presentation only —
 * `dive_sites.max_depth_meters` stays canonical metres, so flipping this never
 * changes a stored depth or what a certification ceiling compares against.
 */
export async function setShopDepthUnit(db: DbExecutor, shopId: string, unit: DepthUnit) {
  const [shop] = await db
    .update(shops)
    .set({ depthUnit: unit })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/** One-tap buddy policy only; it does not change boarding or admission. */
export async function setShopJuniorBuddyPolicy(db: DbExecutor, shopId: string, required: boolean) {
  await db.update(shops).set({ requireAdultBuddyForTeens: required }).where(eq(shops.id, shopId));
}

/**
 * Sets whether the shop reads water temperature in Celsius or Fahrenheit.
 * Presentation only, on the same terms as the depth unit above —
 * `trips.water_temperature_c` stays canonical Celsius, so flipping this never
 * changes a stored reading. Independent of the depth unit on purpose: a shop
 * that dives in feet and talks about the water in Celsius is a real shop.
 */
export async function setShopTemperatureUnit(db: AppDb, shopId: string, unit: TemperatureUnit) {
  const [shop] = await db
    .update(shops)
    .set({ temperatureUnit: unit })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Replaces the shop's rental catalog — which gear it rents. The route narrows
 * the incoming values to known kinds (src/lib/rentals.ts) before calling this,
 * so an unknown string can never be stored.
 */
export async function setShopRentalItems(db: AppDb, shopId: string, rentalItems: string[]) {
  const [shop] = await db
    .update(shops)
    .set({ rentalItems })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Replaces the notes Claude reads when it drafts a reply (`shops.reply_notes`).
 * The action trims and caps the box first, so what arrives is text within
 * `REPLY_NOTES_MAX_LENGTH`, or `null` for none.
 */
export async function setShopReplyNotes(db: AppDb, shopId: string, replyNotes: string | null) {
  const [shop] = await db
    .update(shops)
    .set({ replyNotes })
    .where(eq(shops.id, shopId))
    .returning({ id: shops.id });
  return shop ?? null;
}

/**
 * Writes the Rentals page's whole save in one UPDATE, so a failed write changes
 * none of its columns: the catalog, the price list, the terms every rental
 * ticket prints, and the two optional settings. An omitted optional setting is
 * left as stored (the regulator interval while work orders are off, the nitrox
 * fill method when the form does not post it). The route validates and
 * normalizes every value before calling this.
 */
export async function saveShopRentals(
  db: DbExecutor,
  shopId: string,
  write: {
    rentalItems: string[];
    rentalPricing: RentalPricing;
    rentalTerms: string | null;
    customerRegulatorServiceMonths?: CustomerRegulatorServiceMonths;
    nitroxFillMethod?: NitroxFillMethod;
  },
) {
  const [shop] = await db
    .update(shops)
    .set({
      rentalItems: write.rentalItems,
      rentalPricing: write.rentalPricing,
      rentalTerms: write.rentalTerms,
      ...(write.customerRegulatorServiceMonths !== undefined
        ? { customerRegulatorServiceMonths: write.customerRegulatorServiceMonths }
        : {}),
      ...(write.nitroxFillMethod !== undefined ? { nitroxFillMethod: write.nitroxFillMethod } : {}),
    })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Sets the front-desk address published on the shop's public pages. Empty
 * strings clear the field rather than publishing a blank contact, so a shop can
 * take itself back off the public page by emptying the box.
 *
 * A changed address starts unconfirmed: `contactEmailConfirmedAt` vouches for
 * one specific address, so it is cleared in the same write whenever the
 * address differs from what was on file (case-insensitively -- the same
 * comparison the confirm consumes against). Saving the same address again
 * keeps its confirmation; a confirm-then-edit would otherwise carry the old
 * proof onto a new inbox (issue #1288).
 */
export async function setShopContact(
  db: AppDb,
  shopId: string,
  contact: { contactEmail: string; contactPhone: string },
) {
  const contactEmail = contact.contactEmail.trim() || null;
  const [shop] = await db
    .update(shops)
    .set({
      contactEmail,
      contactPhone: contact.contactPhone.trim() || null,
      contactEmailConfirmedAt:
        contactEmail === null
          ? null
          : sql`case when lower(${shops.contactEmail}) = lower(${contactEmail}) then ${shops.contactEmailConfirmedAt} else null end`,
    })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Replaces the shop's physical business address as a whole, published in
 * structured data so search engines can place the shop as a real venue.
 *
 * This is a full replacement, not a patch: every field is written, and an
 * omitted field (or latitude/longitude) is stored as null. Text fields are
 * trimmed, and a blank one becomes null, so an empty address clears the row.
 * Callers must pass the complete address they mean to keep.
 */
export async function setShopAddress(
  db: AppDb,
  shopId: string,
  address: {
    addressStreet?: string | null;
    addressLocality?: string | null;
    addressRegion?: string | null;
    addressPostalCode?: string | null;
    addressCountry?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  },
) {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  const [shop] = await db
    .update(shops)
    .set({
      addressStreet: clean(address.addressStreet),
      addressLocality: clean(address.addressLocality),
      addressRegion: clean(address.addressRegion),
      addressPostalCode: clean(address.addressPostalCode),
      addressCountry: clean(address.addressCountry),
      latitude: address.latitude ?? null,
      longitude: address.longitude ?? null,
    })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Whether this shop's public pages may be listed in search engines.
 *
 * `listed` is the default and the state every shop starts in; `false` stamps
 * `search_listing_opt_out_at`, which drops the shop out of `sitemap.xml` *and*
 * makes its public pages emit `robots: noindex`
 * (ADR 20260813-search-listing-is-a-choice). Turning it back on clears the
 * stamp rather than recording a second one — this is a switch, not a trail;
 * the only question anyone asks of it later is which way it is set now, and
 * when it was last turned off.
 */
export async function setShopSearchListing(
  db: AppDb,
  shopId: string,
  listed: boolean,
  now: Date = nowDate(),
) {
  const [shop] = await db
    .update(shops)
    .set({ searchListingOptOutAt: listed ? null : now })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Where a post-trip review request sends a diver. An empty string clears it —
 * with none set, the recap flow skips the review ask entirely rather than
 * guessing a platform (docs ADR 20260726-post-trip-review-request).
 */
export async function setShopReviewUrl(db: AppDb, shopId: string, reviewUrl: string) {
  const [shop] = await db
    .update(shops)
    .set({ reviewUrl: reviewUrl.trim() || null })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/** Sets which kinds of diving the shop runs. */
export async function setShopDivingOptions(
  db: AppDb,
  shopId: string,
  options: {
    hasBoatDiving: boolean;
    hasShoreDiving: boolean;
    hasPoolDiving: boolean;
  },
) {
  const [shop] = await db.update(shops).set(options).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/** Turns the shop's crew schedule on or off (`shops.crew_schedule_enabled`). */
export async function setShopCrewScheduleEnabled(
  db: AppDb,
  shopId: string,
  crewScheduleEnabled: boolean,
) {
  const [shop] = await db
    .update(shops)
    .set({ crewScheduleEnabled })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/** Sets the divemaster target the crew schedule's nudges are measured against. */
export async function setShopDiversPerDivemaster(
  db: AppDb,
  shopId: string,
  diversPerDivemaster: number,
) {
  const [shop] = await db
    .update(shops)
    .set({ diversPerDivemaster })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Turns one optional feature on or off (`src/lib/shop-features.ts`). Nothing
 * the feature wrote is touched, so turning it back on finds everything where
 * it was.
 */
export async function setShopFeature(
  db: AppDb,
  shopId: string,
  feature: ShopFeature,
  enabled: boolean,
) {
  const [shop] = await db
    .update(shops)
    .set({ [SHOP_FEATURE_COLUMNS[feature]]: enabled })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Whether the shop has one optional feature on. A server action behind a
 * switch asks this before it writes, so a hand-built post to a feature the
 * shop turned off writes nothing (the page that held the form is gone).
 */
export async function shopHasFeatureOn(
  db: DbExecutor,
  shopId: string,
  feature: ShopFeature,
): Promise<boolean> {
  const [shop] = await db
    .select({ on: shops[SHOP_FEATURE_COLUMNS[feature]] })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return shop?.on === true;
}

/**
 * The on/off columns the Features page writes: the optional features, Stripe
 * Tax, the crew schedule and the three kinds of diving.
 */
export type ShopSwitches = Partial<
  Pick<
    typeof shops.$inferSelect,
    | ShopFeatureColumn
    | "taxEnabled"
    | "crewScheduleEnabled"
    | "hasBoatDiving"
    | "hasShoreDiving"
    | "hasPoolDiving"
  >
>;

/** Everything one Save of the Features page writes: its switches, and the notes for AI when drawn. */
export type FeaturesPageWrite = ShopSwitches &
  Partial<Pick<typeof shops.$inferSelect, "replyNotes">>;

/**
 * Writes the Features page's switches (and, when the page drew the box, the
 * notes for AI) in one statement, so a save lands whole or not at all. A
 * column absent from `switches` is left as it was: only the rows the page
 * drew, and the reader may flip, are ever named.
 */
export async function setShopSwitches(db: AppDb, shopId: string, switches: FeaturesPageWrite) {
  if (Object.keys(switches).length === 0) return null;
  const [shop] = await db.update(shops).set(switches).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/**
 * Replaces the storefront's photo strip, but only if it still reads `expected`.
 *
 * The save uploads between reading the strip and writing it, so two staffers
 * saving at once could each write a list built from a stale read: one would
 * put back a photo the other just deleted from storage, or drop the other's
 * new photo with nothing left pointing at it. Comparing the stored list in the
 * `where` makes the slower save lose cleanly. Returns false when it lost.
 */
export async function replaceShopfrontPhotos(
  db: AppDb,
  shopId: string,
  expected: string[],
  next: string[],
): Promise<boolean> {
  const updated = await db
    .update(shops)
    .set({ shopfrontPhotoUrls: next })
    .where(
      and(
        eq(shops.id, shopId),
        sql`${shops.shopfrontPhotoUrls} = ${JSON.stringify(expected)}::jsonb`,
      ),
    )
    .returning({ id: shops.id });
  return updated.length > 0;
}

/**
 * Sets the shop's tagline, about/description prose, and brand logo URL.
 */
export async function setShopProfile(
  db: AppDb,
  shopId: string,
  profile: {
    tagline?: string | null;
    description?: string | null;
    logoUrl?: string | null;
    /** Harbor's brand fields (ADR 20260901-diveday-reimagined, decision 2). */
    brandColor?: string | null;
    brandDisplayFont?: BrandDisplayFontCode | null;
    brandHeroImageUrl?: string | null;
    brandHeroImageAlt?: string | null;
    establishedYear?: number | null;
    brandBadges?: BrandBadgeCode[];
  },
) {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  const [shop] = await db
    .update(shops)
    .set({
      ...(profile.tagline !== undefined ? { tagline: clean(profile.tagline) } : {}),
      ...(profile.description !== undefined ? { description: clean(profile.description) } : {}),
      ...(profile.logoUrl !== undefined ? { logoUrl: clean(profile.logoUrl) } : {}),
      ...(profile.brandColor !== undefined ? { brandColor: clean(profile.brandColor) } : {}),
      ...(profile.brandDisplayFont !== undefined
        ? { brandDisplayFont: profile.brandDisplayFont }
        : {}),
      ...(profile.brandHeroImageUrl !== undefined
        ? { brandHeroImageUrl: clean(profile.brandHeroImageUrl) }
        : {}),
      ...(profile.brandHeroImageAlt !== undefined
        ? { brandHeroImageAlt: clean(profile.brandHeroImageAlt) }
        : {}),
      ...(profile.establishedYear !== undefined
        ? { establishedYear: profile.establishedYear }
        : {}),
      ...(profile.brandBadges !== undefined ? { brandBadges: profile.brandBadges } : {}),
    })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}
