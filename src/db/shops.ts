import { and, eq, exists, gt, isNull, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DepthUnit } from "@/lib/depth-units";
import type { DockDayRhythm } from "@/lib/diver-planning";
import type { EmergencyReference } from "@/lib/emergency-reference";
import type { ShopCurrency } from "@/lib/money";
import type { RentalPricing } from "@/lib/rentals";
import type { SendWindow } from "@/lib/send-window";
import type { TemperatureUnit } from "@/lib/temperature-units";
import type { AppDb } from "./client";
import { courses, divePackages, orders, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

export async function getShopBySlug(db: AppDb, slug: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  return shop ?? null;
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
export async function listShopsForSitemap(db: AppDb): Promise<{ slug: string }[]> {
  return db
    .select({ slug: shops.slug })
    .from(shops)
    .where(
      and(
        eq(shops.isDemo, false),
        isNull(shops.searchListingOptOutAt),
        exists(
          db
            .select({ one: trips.id })
            .from(trips)
            .where(and(eq(trips.shopId, shops.id), eq(trips.status, "scheduled"), liveTrip())),
        ),
      ),
    );
}

export async function getShopById(db: AppDb, id: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, id)).limit(1);
  return shop ?? null;
}

/** Replaces the shop-wide diver packing checklist after route-level validation. */
export async function setShopPackingList(db: AppDb, shopId: string, packingList: string[]) {
  const [shop] = await db
    .update(shops)
    .set({ packingList })
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

/** Turns Stripe Tax on or off for charges created after this setting is saved. */
export async function setShopTaxEnabled(db: AppDb, shopId: string, taxEnabled: boolean) {
  const [shop] = await db.update(shops).set({ taxEnabled }).where(eq(shops.id, shopId)).returning();
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

export async function setShopDockDayRhythm(db: AppDb, shopId: string, rhythm: DockDayRhythm) {
  const [shop] = await db.update(shops).set(rhythm).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/**
 * The hours during which the shop's automated messages may reach a diver —
 * shop-local, and the only thing standing between a Fiji shop and a 3 AM text
 * (`src/lib/send-window.ts`, issue #697).
 */
export async function setShopSendWindow(db: AppDb, shopId: string, window: SendWindow) {
  const [shop] = await db
    .update(shops)
    .set({ sendWindowStartHour: window.startHour, sendWindowEndHour: window.endHour })
    .where(eq(shops.id, shopId))
    .returning();
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

/**
 * Sets whether the shop reads depth in metres or feet. Presentation only —
 * `dive_sites.max_depth_meters` stays canonical metres, so flipping this never
 * changes a stored depth or what a certification ceiling compares against.
 */
export async function setShopDepthUnit(db: AppDb, shopId: string, unit: DepthUnit) {
  const [shop] = await db
    .update(shops)
    .set({ depthUnit: unit })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
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
 * Replaces the shop's rental price list (set price, per-piece prices, per-dive
 * nitrox surcharge). The route validates and normalizes amounts to minor units
 * before calling this; a price is never inventory, only what a diver is quoted.
 */
export async function setShopRentalPricing(
  db: AppDb,
  shopId: string,
  rentalPricing: RentalPricing,
) {
  const [shop] = await db
    .update(shops)
    .set({ rentalPricing })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Sets the front-desk address published on the shop's public pages. Empty
 * strings clear the field rather than publishing a blank contact, so a shop can
 * take itself back off the public page by emptying the box.
 */
export async function setShopContact(
  db: AppDb,
  shopId: string,
  contact: { contactEmail: string; contactPhone: string },
) {
  const [shop] = await db
    .update(shops)
    .set({
      contactEmail: contact.contactEmail.trim() || null,
      contactPhone: contact.contactPhone.trim() || null,
    })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Sets the shop's physical business address, published in structured data so
 * search engines can place the shop as a real venue. Each field clears
 * independently on an empty string, so a shop can walk an address back to
 * nothing (or fill in only what it knows, like locality and country) rather
 * than being forced to supply all five at once.
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

/** Sets which kinds of diving the shop runs, and its target diver-to-divemaster ratio. */
export async function setShopDivingOptions(
  db: AppDb,
  shopId: string,
  options: {
    hasBoatDiving: boolean;
    hasShoreDiving: boolean;
    hasPoolDiving: boolean;
    /** The divers half of the shop's target ratio (`src/lib/divemaster-ratio.ts`). */
    diversPerDivemaster?: number;
  },
) {
  const [shop] = await db.update(shops).set(options).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
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
  },
) {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  const [shop] = await db
    .update(shops)
    .set({
      ...(profile.tagline !== undefined ? { tagline: clean(profile.tagline) } : {}),
      ...(profile.description !== undefined ? { description: clean(profile.description) } : {}),
      ...(profile.logoUrl !== undefined ? { logoUrl: clean(profile.logoUrl) } : {}),
    })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Replaces the shop-configured conservation commitments after validation.
 */
export async function setShopConservationCommitments(
  db: AppDb,
  shopId: string,
  conservationCommitments: string[],
) {
  const [shop] = await db
    .update(shops)
    .set({ conservationCommitments })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}
