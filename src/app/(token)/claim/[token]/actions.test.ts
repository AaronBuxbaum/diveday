// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";

/**
 * **The claim page says what happened** (Aaron, 2026-11-06, superseding the
 * same-answer rule of #2381). These drive the real action against a real
 * database: a claim that worked, an address that already holds a seat on the
 * trip, and a spent link each land on their own answer.
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
    sendClaimedSeatConfirmation: (
      db: never,
      shopId: string,
      bookingId: string,
      options: Parameters<typeof actual.sendClaimedSeatConfirmation>[3],
    ) =>
      actual.sendClaimedSeatConfirmation(db, shopId, bookingId, {
        ...options,
        provider: mail.current?.provider,
      }),
  };
});

const { eq } = await import("drizzle-orm");
const { createBookingParty } = await import("@/db/bookings");
const { verifyBookingCapability } = await import("@/db/booking-capabilities");
const { bookings, people, waiverRecords } = await import("@/db/schema");
const { nowDate } = await import("@/lib/clock");
const { issuePartySeatClaims } = await import("../../../../features/seat-claims/store");
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
  return { tokens: [token(one.bookingId), token(two.bookingId)] as const };
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

describe("claimSeatAction says what happened", () => {
  it("lands a claim that worked on the claimed page, and emails the claimant", async () => {
    const { tokens } = await party();
    mail.current = fakeEmail();
    expect(await submit(tokens[0], "Milo Member", "milo@example.com")).toBe(
      `/claim/${tokens[0]}?claimed=1`,
    );
    expect(mail.current.sent.map((m) => [m.kind, m.to])).toEqual([
      ["booking_confirmation", "milo@example.com"],
    ]);
  });

  it("tells an address that already holds a seat on the trip so, and leaves the link working", async () => {
    const { tokens } = await party();
    mail.current = fakeEmail();
    // The organizer's own address, already holding a seat on this trip.
    expect(await submit(tokens[1], "Orla Organizer", "orla@example.com")).toBe(
      `/claim/${tokens[1]}?error=held`,
    );
    // The page itself says it; nobody is mailed.
    expect(mail.current.sent).toHaveLength(0);

    // A party member who typed the wrong address can claim with their own.
    const live = await verifyBookingCapability(ctx.db, {
      token: tokens[1],
      purpose: "claim",
      now: nowDate(),
    });
    expect(live).not.toBeNull();
    const [seat] = await ctx.db
      .select({ claimedAt: bookings.claimedAt })
      .from(bookings)
      .where(eq(bookings.id, live?.bookingId ?? ""));
    expect(seat?.claimedAt).toBeNull();
    expect(await submit(tokens[1], "Pia Member", "pia@example.com")).toBe(
      `/claim/${tokens[1]}?claimed=1`,
    );
  });

  it("sends a spent link back to the claim page, which says what happened", async () => {
    const { tokens } = await party();
    mail.current = fakeEmail();
    await submit(tokens[0], "Milo Member", "milo@example.com");
    expect(await submit(tokens[0], "Milo Member", "milo@example.com")).toBe(`/claim/${tokens[0]}`);
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
});
