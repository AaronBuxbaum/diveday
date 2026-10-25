import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import {
  bookingCheckoutBookings,
  bookings,
  people,
  rentalFitProfiles,
  shops,
  trips,
} from "@/db/schema";
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
      rentalPricing: {
        setCents: null,
        perItemCents: { bcd: 1500, wetsuit: 1200 },
        nitroxCents: null,
      },
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

/**
 * Book one seat as `fullName` on `email` (Dana's by default), ticking a rented
 * wetsuit unless told not to, and a rented BCD or nitrox when asked.
 */
async function book(
  shopSlug: string,
  tripId: string,
  fullName: string,
  options: { email?: string; bcd?: boolean; wetsuit?: boolean; nitrox?: boolean } = {},
) {
  const form = new FormData();
  form.set("partySize", "1");
  form.set("fullName-0", fullName);
  form.set("email-0", options.email ?? EMAIL);
  if (options.wetsuit ?? true) form.set("gear-0-wetsuit", "on");
  if (options.bcd) form.set("gear-0-bcd", "on");
  if (options.nitrox) form.set("nitrox-0", "on");
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

/**
 * **What the card is charged for gear, read off the checkout itself** (issue
 * #2795). Stripe is faked at its HTTP edge: a test key, and a `fetch` that
 * records each Checkout Session request and answers it as Stripe would. The
 * per-seat `gear_cents` snapshot is the checkout total's gear half.
 */
function fakeStripe() {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_gear_fit");
  const sessions: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (!String(url).startsWith("https://api.stripe.com/v1/checkout/sessions")) {
        return new Response("{}", { status: 404 });
      }
      const body = new URLSearchParams(String(init?.body ?? ""));
      sessions.push(body);
      let total = 0;
      for (let index = 0; body.has(`line_items[${index}][quantity]`); index++) {
        total +=
          Number(body.get(`line_items[${index}][price_data][unit_amount]`)) *
          Number(body.get(`line_items[${index}][quantity]`));
      }
      const id = `cs_gear_${sessions.length}`;
      return Response.json({
        id,
        status: "open",
        payment_status: "unpaid",
        url: `https://checkout.stripe.com/c/pay/${id}`,
        amount_total: total,
        expires_at: Math.floor(nowDate().getTime() / 1000) + 3600,
      });
    }),
  );
  return {
    sessions,
    lineNames: () =>
      sessions.flatMap((body) =>
        [...body.entries()]
          .filter(([key]) => key.endsWith("[price_data][product_data][name]"))
          .map(([, name]) => name),
      ),
  };
}

async function gearCentsOn(db: AppDb, tripId: string) {
  const seats = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.tripId, tripId));
  return db
    .select({ gearCents: bookingCheckoutBookings.gearCents })
    .from(bookingCheckoutBookings)
    .where(
      inArray(
        bookingCheckoutBookings.bookingId,
        seats.map((seat) => seat.id),
      ),
    );
}

describe("gear on a course whose fee includes it", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("charges the card for the gear ticked on an ordinary departure", async () => {
    // The control: the harness below sees a rental charge when there is one.
    const { db, shop } = ctx;
    const { tripId } = await gearShop(db, shop.id);
    const stripe = fakeStripe();

    await book(shop.slug, tripId, "Wren Charter", { email: "wren@example.com", bcd: true });

    expect(stripe.sessions).toHaveLength(1);
    expect(stripe.lineNames()).toContain("Rental gear");
    expect(await gearCentsOn(db, tripId)).toEqual([{ gearCents: 1_500 + 1_200 }]);
  });

  it("names a nitrox-only charge as nitrox, not as rental gear", async () => {
    // Domain review of #2795: a student on a gear-included course who only
    // ticks nitrox must not read "Rental gear" on a card statement.
    const { db, shop } = ctx;
    const { tripId } = await gearShop(db, shop.id);
    await db
      .update(shops)
      .set({
        rentalItems: ["bcd", "wetsuit", "drysuit", "nitrox"],
        rentalPricing: {
          setCents: null,
          perItemCents: { bcd: 1500, wetsuit: 1200 },
          nitroxCents: 900,
        },
      })
      .where(eq(shops.id, shop.id));
    const stripe = fakeStripe();

    await book(shop.slug, tripId, "Nia Nitrox", {
      email: "nia@example.com",
      wetsuit: false,
      nitrox: true,
    });

    expect(stripe.lineNames()).toContain("Nitrox fills");
    expect(stripe.lineNames()).not.toContain("Rental gear");
  });

  it("charges no rental on a gear-included course session, whatever the post ticks", async () => {
    const { db, shop } = ctx;
    await gearShop(db, shop.id);
    // The seed's Discover Scuba session: its course includes the gear, and its
    // instructor is already on the crew.
    const [session] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, "Discover Scuba — Pool & Reef")));
    expect(session, "the seeded Discover Scuba session").toBeDefined();
    const stripe = fakeStripe();
    const email = "nora.student@example.com";

    // A hand-built post: the form offers neither box on this session.
    await book(shop.slug, session.id, "Nora Student", { email, bcd: true });

    expect(stripe.sessions, "the course fee still goes to checkout").toHaveLength(1);
    expect(stripe.lineNames()).not.toContain("Rental gear");
    expect(await gearCentsOn(db, session.id)).toEqual([{ gearCents: 0 }]);
    // Nothing written as the student's fit either: `/ready` asks for the
    // scuba unit's sizes from a blank form, not from "rents nothing".
    const [student] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, email)));
    expect(await fitOf(db, shop.id, student.id)).toBeUndefined();
    const [seat] = await db
      .select({ paidRentalKinds: bookings.paidRentalKinds })
      .from(bookings)
      .where(and(eq(bookings.tripId, session.id), eq(bookings.personId, student.id)));
    expect(seat?.paidRentalKinds).toEqual([]);
  });
});
