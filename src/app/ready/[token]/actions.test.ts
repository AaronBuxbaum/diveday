// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readKioskInput } from "@/lib/kiosk-check-in";
import { seededShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

/**
 * **The diver killing the code on a card they have lost** — `stopArrivalCodesFromReady`,
 * issue #1729.
 *
 * Against a real database rather than spies, unlike this page's siblings, and
 * the reason is what the action is *for*. Its whole effect is off-screen, three
 * modules away: the QR inside a printed arrival card stops finding a seat at a
 * shop's self check-in tablet. A spy asserting that `revokeBookingCapabilities`
 * was called with `purpose: "arrival"` would have passed on every draft of this,
 * including the ones that revoked the wrong booking's codes or took the diver's
 * own readiness link down with them. So the assertions are the two the ticket
 * pins — revoke-then-scan and revoke-then-redownload — plus the three that turn
 * a correct action into a cross-booking one after a later refactor and are
 * invisible in the happy path.
 *
 * `findKioskSeats` is the counter's own reader, so a scan here walks the same
 * `verifyBookingCapability` gate a wedge scanner walks
 * (`bookingForArrivalCode`, `src/db/kiosk-check-in.ts`). What the tablet does
 * *after* a hit is `src/db/kiosk-check-in.test.ts`'s subject and is untouched by
 * any of this.
 */

const CALLER_IP = "203.0.113.7";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws to unwind the action; mirroring that keeps the
    // tests honest about the code after a redirect never running.
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// The action is called directly, outside a Next request scope, so the two
// request-scoped reads `contextFor` makes need a stand-in: the forwarded
// address the shared throttle buckets on, and the `Accept-Language` it records
// against the person. The request asks for no language.
vi.mock("next/headers", () => nextHeadersStub({ headers: { "x-forwarded-for": CALLER_IP } }));
// Partially mocked so a test can empty the bucket: the real token bucket needs
// sixty calls to say no, and what is worth pinning is the refusal, not the
// arithmetic (`rate-limit.test.ts` owns that).
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { getDb } = await import("@/db/client");
const { hasLiveArrivalCapability, issueBookingCapability, verifyBookingCapability } = await import(
  "@/db/booking-capabilities"
);
const { createBooking } = await import("@/db/bookings");
const { findKioskSeats } = await import("@/db/kiosk-check-in");
const { upcomingTripsWithCounts, getTripRoster } = await import("@/db/trips");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { stopArrivalCodesFromReady } = await import("./actions");

/**
 * A seat on the seeded reef boat, the readiness link its diver reads the thread
 * through, and one `arrival` code — the position a diver is in the moment after
 * they save the card.
 *
 * The reef boat by title, and `atTheDoor` stated rather than inferred, for the
 * reasons `src/db/kiosk-check-in.test.ts`'s `counter()` gives: the tablet's
 * window is two hours wide and the seeded day is not, so leaning on wherever
 * the frozen clock sits relative to the seed would make this a tripwire on the
 * demo's schedule.
 */
async function savedTheCard() {
  const { db, shop } = await seededShopContext();
  const upcoming = await upcomingTripsWithCounts(db, shop.id);
  const reef = upcoming.find((trip) => trip.title === "Two-Tank Reef — Molasses & French");
  if (!reef) throw new Error("seeded reef trip missing");
  const [seat] = await getTripRoster(db, shop.id, reef.id);
  if (!seat) throw new Error("seeded booking missing");

  const readiness = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: seat.booking.id,
    purpose: "readiness",
  });
  if (!readiness) throw new Error("readiness capability not issued");
  const card = await mintCard(db, shop.id, seat.booking.id);

  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  return {
    db,
    shop,
    reef,
    bookingId: seat.booking.id,
    token: readiness.token,
    card,
    /** Ten minutes before the reef boat leaves, the way every kiosk lookup states it. */
    atTheDoor: new Date(reef.startsAt.getTime() - 10 * 60 * 1000),
  };
}

/**
 * What a download does, and the only thing that ever mints one of these: the
 * arrival-card route calls exactly this
 * (`src/app/s/[shopSlug]/trips/[id]/arrival-card/route.ts`, whose own test owns
 * the HTML, the QR and the expiry).
 */
async function mintCard(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  bookingId: string,
): Promise<string> {
  const issued = await issueBookingCapability(db, { shopId, bookingId, purpose: "arrival" });
  if (!issued) throw new Error("arrival code not issued");
  return issued.token;
}

/** A second seat on the same boat at the same shop, holding a card of its own. */
async function anotherDiverWithACard(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  tripId: string,
) {
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!outcome.ok) throw new Error("expected the second booking to succeed");
  return { bookingId: outcome.bookingId, card: await mintCard(db, shopId, outcome.bookingId) };
}

/** Where the action sent the diver, without the redirect's control-flow throw. */
async function redirectedTo(token: string): Promise<string> {
  try {
    await stopArrivalCodesFromReady(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

describe("stopArrivalCodesFromReady", () => {
  it("stops the code on a printed card, so it finds nothing at the counter", async () => {
    const { db, shop, bookingId, token, card, atTheDoor } = await savedTheCard();
    const scan = () =>
      findKioskSeats(db, { shopId: shop.id, lookup: readKioskInput(card), now: atTheDoor });

    // The positive half, first: without it a later `[]` could be the fixture
    // failing rather than the revoke working.
    expect((await scan()).map((row) => row.bookingId)).toEqual([bookingId]);

    expect(await redirectedTo(token)).toBe(`/ready/${token}?saved=arrival-code`);

    expect(await scan()).toEqual([]);
  });

  it("leaves the diver holding their own thread, which is the whole of the purpose scoping", async () => {
    const { db, token } = await savedTheCard();
    await redirectedTo(token);

    // The failure this exists for: a revoke that forgot `purpose` takes down
    // the readiness link the diver is reading the page through — every
    // capability for the booking is in one table — and the recovery path the
    // copy promises ("save the card again") is on the page it just killed.
    expect(await verifyBookingCapability(db, { token, purpose: "readiness" })).not.toBeNull();
  });

  it("saving the card again mints a code that works", async () => {
    const { db, shop, bookingId, token, card, atTheDoor } = await savedTheCard();
    await redirectedTo(token);

    const fresh = await mintCard(db, shop.id, bookingId);
    expect(fresh).not.toBe(card);
    expect(
      (
        await findKioskSeats(db, {
          shopId: shop.id,
          lookup: readKioskInput(fresh),
          now: atTheDoor,
        })
      ).map((row) => row.bookingId),
    ).toEqual([bookingId]);
    // And the one it replaced is still dead, so "a fresh download gives you a
    // new one" is not "the old one comes back".
    expect(
      await findKioskSeats(db, { shopId: shop.id, lookup: readKioskInput(card), now: atTheDoor }),
    ).toEqual([]);
  });

  it("reaches one booking's codes and no other seat's", async () => {
    const { db, shop, reef, token } = await savedTheCard();
    const neighbour = await anotherDiverWithACard(db, shop.id, reef.id);

    await redirectedTo(token);

    // Same shop, same boat, a different seat. Nothing about the token names
    // this booking, and a `where` that lost `bookingId` would strand a stranger
    // at the counter on the morning of their dive.
    expect(
      await verifyBookingCapability(db, { token: neighbour.card, purpose: "arrival" }),
    ).not.toBeNull();
    expect(
      await hasLiveArrivalCapability(db, { shopId: shop.id, bookingId: neighbour.bookingId }),
    ).toBe(true);
    // A cross-*shop* case would add nothing here and is deliberately absent:
    // the shop written is the resolved booking's own (`ctx.data.shop.id`), so
    // there is no caller-supplied tenant for a test to cross. What a token can
    // vary is which booking it resolves to, which is this.
  });

  it("answers a token that resolves to nothing exactly as it answers a live one, and revokes nothing", async () => {
    const { db, shop, bookingId, card, atTheDoor } = await savedTheCard();

    // The oracle this action must not be: a bearer of a guessed URL learns the
    // same thing from a real booking as from no booking, which is the bare page
    // and its "this link isn't available" notice — never a 404 here and a
    // redirect there.
    expect(await redirectedTo("not-a-token-anybody-issued")).toBe(
      "/ready/not-a-token-anybody-issued",
    );

    expect(
      (
        await findKioskSeats(db, {
          shopId: shop.id,
          lookup: readKioskInput(card),
          now: atTheDoor,
        })
      ).map((row) => row.bookingId),
    ).toEqual([bookingId]);
  });

  it("says wait when the shared bucket is empty, and still revokes nothing", async () => {
    const { db, shop, bookingId, token, card, atTheDoor } = await savedTheCard();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1_000 });

    // `?error=rate`, not a silent bounce: a throttled tap that redirected to
    // the bare page would read as a button that did nothing (task 49).
    expect(await redirectedTo(token)).toBe(`/ready/${token}?error=rate`);

    expect(
      (
        await findKioskSeats(db, {
          shopId: shop.id,
          lookup: readKioskInput(card),
          now: atTheDoor,
        })
      ).map((row) => row.bookingId),
    ).toEqual([bookingId]);
  });
});
