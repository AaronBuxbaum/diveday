// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";

/**
 * **A claim for an address that already holds a seat looks exactly like a claim
 * that worked** (issue #2381, Aaron's option b). Anyone holding a claim link can
 * type any address, so a different answer for a booked address would tell them
 * who is on the manifest. These drive the real action against a real database:
 * two submissions, one for an address that holds a seat on the trip and one that
 * does not, must redirect to the same URL, and the only difference is which
 * inbox receives which email.
 */
const ctx = fileScopedShopContext();

const { mail, pending } = vi.hoisted(() => ({
  mail: { current: null as null | ReturnType<typeof import("@/test/fakes").fakeEmail> },
  pending: [] as Array<() => unknown>,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((callback: () => unknown) => {
    pending.push(callback);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(async () => ctx.db),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/i18n/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/request")>()),
  requestFirstHandLocale: vi.fn(async () => "en-US"),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
}));
// The real senders, handed a recording provider instead of SES.
vi.mock("@/db/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/notifications")>();
  return {
    ...actual,
    sendClaimedSeatConfirmation: (db: never, shopId: string, bookingId: string) =>
      actual.sendClaimedSeatConfirmation(db, shopId, bookingId, mail.current?.provider),
  };
});
vi.mock("@/db/seat-already-held", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/seat-already-held")>();
  return {
    ...actual,
    tellSeatAlreadyHeld: (
      db: never,
      input: { shopId: string; bookingId: string; attempt: "claim" | "booking" },
    ) => actual.tellSeatAlreadyHeld(db, input, { provider: mail.current?.provider }),
  };
});

const { eq } = await import("drizzle-orm");
const { createBookingParty } = await import("@/db/bookings");
const { verifyBookingCapability } = await import("@/db/booking-capabilities");
const { hashCapabilityToken } = await import("@/lib/booking-capabilities");
const { bookings, bookingCapabilities, people, waiverRecords } = await import("@/db/schema");
const { nowDate } = await import("@/lib/clock");
const { issuePartySeatClaims } = await import("@/db/seat-claims");
const { upcomingTripsWithCounts } = await import("@/db/trips");
const { claimSeatAction } = await import("./actions");

async function party() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (t) => t.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!trip) throw new Error("expected seeded trip missing");
  const booked = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Orla Organizer",
      email: "orla@example.com",
    },
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Milo Member" },
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Pia Member" },
  ]);
  if (!booked.ok) throw new Error(`party booking failed: ${booked.reason}`);
  const [lead, one, two] = booked.bookings;
  if (!lead || !one || !two) throw new Error("incomplete party");
  const seats = await issuePartySeatClaims(db, { shopId: shop.id, leadBookingId: lead.bookingId });
  const token = (bookingId: string) => {
    const seat = seats.find((entry) => entry.bookingId === bookingId);
    if (!seat?.claim) throw new Error("expected a claim link");
    return seat.claim.token;
  };
  return { lead, tokens: [token(one.bookingId), token(two.bookingId)] as const };
}

function form(name: string, email: string): FormData {
  const data = new FormData();
  data.set("fullName", name);
  data.set("email", email);
  return data;
}

async function submit(
  token: string,
  name: string,
  email: string,
  beforeDeferred?: () => Promise<void>,
): Promise<string> {
  pending.length = 0;
  let landed = "";
  try {
    await claimSeatAction(token, form(name, email));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.startsWith("REDIRECT:")) throw error;
    landed = message.slice("REDIRECT:".length);
  }
  await beforeDeferred?.();
  // The work the action deferred until after the response.
  await Promise.all(pending.map((callback) => callback()));
  return landed;
}

describe("claimSeatAction answers a booked address as it answers a fresh one", () => {
  it("redirects both to the same URL, and emails each inbox its own answer", async () => {
    const { tokens } = await party();
    const [freshToken, bookedToken] = tokens;

    mail.current = fakeEmail();
    const fresh = await submit(freshToken, "Milo Member", "milo@example.com");
    const freshMail = mail.current.sent;

    mail.current = fakeEmail();
    // The organizer's own address, already holding a seat on this trip.
    const booked = await submit(bookedToken, "Orla Organizer", "orla@example.com");
    const bookedMail = mail.current.sent;

    // Same shape of redirect: the claim URL's own static page, nothing else.
    expect(fresh).toBe(`/claim/${freshToken}?sent=1`);
    expect(booked).toBe(`/claim/${bookedToken}?sent=1`);
    expect(fresh.replace(freshToken, "T")).toBe(booked.replace(bookedToken, "T"));

    // The fresh claimant's confirmation goes to the fresh claimant only.
    expect(freshMail.map((m) => [m.kind, m.to])).toEqual([
      ["booking_confirmation", "milo@example.com"],
    ]);
    // The holder's note goes to the holder only, and names no one else.
    expect(bookedMail.map((m) => [m.kind, m.to])).toEqual([
      ["seat_already_held", "orla@example.com"],
    ]);
  });

  it("leaves the refused seat unclaimed, but its link ends as dead as a spent one", async () => {
    const { tokens } = await party();
    const [freshToken, bookedToken] = tokens;
    const live = (token: string) =>
      verifyBookingCapability(ctx.db, { token, purpose: "claim", now: nowDate() });
    expect(await live(freshToken)).not.toBeNull();
    expect(await live(bookedToken)).not.toBeNull();

    mail.current = fakeEmail();
    await submit(freshToken, "Milo Member", "milo@example.com");
    mail.current = fakeEmail();
    await submit(bookedToken, "Orla Organizer", "orla@example.com");

    // The page behind the link (`/claim/<token>`) answers from this check: a
    // refusal that left its link live while a success killed it would let
    // anyone holding a link learn which addresses hold a seat (issue #2381).
    expect(await live(freshToken)).toBeNull();
    expect(await live(bookedToken)).toBeNull();

    // The refused seat itself is still the organizer's placeholder, unclaimed.
    const [seat] = await ctx.db
      .select({ claimedAt: bookings.claimedAt })
      .from(bookings)
      .innerJoin(bookingCapabilities, eq(bookingCapabilities.bookingId, bookings.id))
      .where(eq(bookingCapabilities.tokenHash, hashCapabilityToken(bookedToken)));
    expect(seat?.claimedAt).toBeNull();

    // A second attempt with the dead link lands where a spent one does.
    mail.current = fakeEmail();
    expect(await submit(bookedToken, "Orla Organizer", "orla@example.com")).toBe(
      `/claim/${bookedToken}`,
    );
    expect(mail.current.sent).toHaveLength(0);
  });

  it("leaves the organizer a fresh link for the seat the refusal killed", async () => {
    const { tokens, lead } = await party();
    mail.current = fakeEmail();
    await submit(tokens[1], "Orla Organizer", "orla@example.com");
    const seats = await issuePartySeatClaims(ctx.db, {
      shopId: ctx.shop.id,
      leadBookingId: lead.bookingId,
    });
    const reissued = seats.filter((seat) => seat.claim && !seat.claimed);
    expect(reissued.length).toBeGreaterThan(0);
    for (const seat of reissued) {
      const verified = await verifyBookingCapability(ctx.db, {
        token: seat.claim?.token ?? "",
        purpose: "claim",
        now: nowDate(),
      });
      expect(verified).not.toBeNull();
    }
  });

  it("answers a claim that worked before its waiver, event and trail work, which all wait for after the response", async () => {
    const { tokens } = await party();
    const waiversFor = async (email: string) =>
      ctx.db
        .select({ id: waiverRecords.id })
        .from(waiverRecords)
        .innerJoin(people, eq(people.id, waiverRecords.personId))
        .where(eq(people.email, email));
    mail.current = fakeEmail();
    let before = -1;
    await submit(tokens[0], "Milo Member", "milo@example.com", async () => {
      before = (await waiversFor("milo@example.com")).length;
    });
    // Nothing the claim sends or records had run when the answer was given.
    expect(before).toBe(0);
    expect((await waiversFor("milo@example.com")).length).toBeGreaterThan(0);
  });

  it("does not send the holder anything for a claim that worked", async () => {
    const { tokens } = await party();
    mail.current = fakeEmail();
    await submit(tokens[0], "Milo Member", "milo@example.com");
    expect(mail.current.sent.some((m) => m.kind === "seat_already_held")).toBe(false);
  });
});
