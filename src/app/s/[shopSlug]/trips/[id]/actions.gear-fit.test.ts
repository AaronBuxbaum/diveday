import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { bookings, people, rentalFitProfiles, shops } from "@/db/schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "@/db/stripe-accounts";
import { createTrip } from "@/db/trips-create";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

/**
 * **The checkout's gear ticks write the fit only of a diver this booking is
 * sure it is.**
 *
 * `bookSpot` persists each party member's priced gear as their rental fit the
 * moment the seat exists (ADR 20260801-checkout-upsells-rental-gear). A seat
 * held on a shared email (H-13) attached itself to an *existing* person whose
 * name on file does not match the one typed, so the booker may be somebody
 * else, and the fit is that diver's standing record. A rented wetsuit ticked
 * there would clear their `dives_dry` and, with it, the drysuit weight check
 * on every later trip (`security-reviewer`, layer 2 of the H-78 work).
 *
 * The real action on a real database, asserting rows: only the framework edge
 * (`next/*`), the request's IP and locale and the app's public URL are
 * stubbed. Stripe has no key here, so the checkout declines to start and the
 * diver lands on the trip page; the gear is written before that.
 */

const ctx = fileScopedShopContext();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, publicAppUrl: vi.fn(() => "https://diveday.test") };
});
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US" as const),
  requestFirstHandLocale: vi.fn(async () => "en-US" as const),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));

const { getDb } = await import("@/db/client");
const { bookSpot } = await import("./actions");

const ACCOUNT = "acct_gear_fit";
const EMAIL = "dana@example.com";

/**
 * The seeded shop, made to price a wetsuit online and take cards, with one
 * paid departure and Dana already on file as a dry diver.
 */
async function gearShop(db: AppDb, shopId: string) {
  vi.mocked(getDb).mockResolvedValue(db);
  await db
    .update(shops)
    .set({
      rentalItems: ["bcd", "wetsuit", "drysuit"],
      rentalPricing: { setCents: null, perItemCents: { wetsuit: 1200 }, nitroxCents: null },
      passThroughFee: null,
    })
    .where(eq(shops.id, shopId));
  await upsertShopStripeAccount(db, shopId, ACCOUNT);
  await setShopStripeAccountStatus(db, ACCOUNT, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId,
    title: "Gear-Fit Two-Tank",
    startsAt: new Date(now.getTime() + 72 * HOUR_MS),
    endsAt: new Date(now.getTime() + 76 * HOUR_MS),
    capacity: 12,
    plannedDives: 2,
    priceCents: 9_000,
  });
  if (!trip) throw new Error("test trip could not be created");
  const [dana] = await db
    .insert(people)
    .values({ shopId, fullName: "Dry Dana", email: EMAIL })
    .returning({ id: people.id });
  await db
    .insert(rentalFitProfiles)
    .values({ shopId, personId: dana.id, rentsDrysuit: true, divesDry: true });
  return { tripId: trip.id, danaId: dana.id };
}

/** Book one seat as `fullName` on Dana's email, ticking a rented wetsuit. */
async function book(shopSlug: string, tripId: string, fullName: string) {
  const form = new FormData();
  form.set("partySize", "1");
  form.set("fullName-0", fullName);
  form.set("email-0", EMAIL);
  form.set("gear-0-wetsuit", "on");
  // The action ends in a redirect, which the mock throws.
  await bookSpot({ shopSlug, tripId, embed: false }, {}, form)
    .then(() => undefined)
    .catch((error: unknown) => {
      if (!(error instanceof Error && error.message.startsWith("REDIRECT:"))) throw error;
    });
}

async function fitOf(db: AppDb, shopId: string, personId: string) {
  const [fit] = await db
    .select()
    .from(rentalFitProfiles)
    .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)));
  return fit;
}

async function seatOf(db: AppDb, tripId: string, personId: string) {
  const [seat] = await db
    .select({
      paidRentalKinds: bookings.paidRentalKinds,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
    })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), eq(bookings.personId, personId)));
  return seat;
}

describe("gear ticked at checkout", () => {
  it("leaves a held seat's matched diver's fit alone, and keeps the paid gear on the booking", async () => {
    const { db, shop } = ctx;
    const { tripId, danaId } = await gearShop(db, shop.id);

    await book(shop.slug, tripId, "Somebody Else");

    const seat = await seatOf(db, tripId, danaId);
    expect(seat, "the seat attached to Dana").toBeDefined();
    expect(seat?.identityUnconfirmedAt, "and is held (H-13)").not.toBeNull();
    // Dana's standing fit is untouched: still dry, still a drysuit, no wetsuit.
    expect(await fitOf(db, shop.id, danaId)).toMatchObject({
      divesDry: true,
      rentsDrysuit: true,
      rentsWetsuit: false,
    });
    // The wetsuit the booker paid for still reaches the rack, on the booking
    // (dive-domain review of issue #2144).
    expect(seat?.paidRentalKinds).toEqual(["wetsuit"]);
  });

  it("records the fit of a diver the booking is sure of", async () => {
    // The control: the same post under the name on file is what reaches the
    // fit, so the hold above is the only thing standing between.
    const { db, shop } = ctx;
    const { tripId, danaId } = await gearShop(db, shop.id);

    await book(shop.slug, tripId, "Dry Dana");

    expect((await seatOf(db, tripId, danaId))?.identityUnconfirmedAt).toBeNull();
    expect(await fitOf(db, shop.id, danaId)).toMatchObject({
      divesDry: false,
      rentsWetsuit: true,
      rentsDrysuit: false,
    });
  });
});
