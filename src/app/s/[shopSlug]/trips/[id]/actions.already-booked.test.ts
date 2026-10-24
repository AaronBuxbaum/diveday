// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";

/**
 * **An already-booked address, or a party rolled back because one member holds
 * a seat, lands on one neutral page** (issue #2691, Aaron's 2026-10-24
 * decision). The public form is anonymous: whoever types an address proves
 * nothing about it, so the screen must not say whether that address holds a
 * seat, and must not name the member who does. The answer goes by email: the
 * holder hears about the seat they already hold, the lead hears the party did
 * not book without being told who held a seat, and nobody else hears anything.
 * A fresh booking is unchanged. The real action on a real database; only the
 * framework edge, the request and the mail provider are stubbed.
 */
const ctx = fileScopedShopContext();

const { mail, pending, heldSeatFails } = vi.hoisted(() => ({
  mail: { current: null as null | ReturnType<typeof import("@/test/fakes").fakeEmail> },
  pending: [] as Array<() => unknown>,
  heldSeatFails: { current: false },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(async () => ctx.db),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US" as const),
  requestFirstHandLocale: vi.fn(async () => "en-US" as const),
}));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  log: vi.fn(),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
}));
// The real senders, handed a recording provider instead of SES.
vi.mock("@/db/seat-already-held", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/seat-already-held")>();
  return {
    ...actual,
    tellSeatAlreadyHeld: (db: never, input: Parameters<typeof actual.tellSeatAlreadyHeld>[1]) =>
      actual.tellSeatAlreadyHeld(db, input, { provider: mail.current?.provider }),
    heldSeatOnTrip: async (db: never, input: Parameters<typeof actual.heldSeatOnTrip>[1]) => {
      if (heldSeatFails.current) throw new Error("connection reset");
      return actual.heldSeatOnTrip(db, input);
    },
    tellPartyNotBooked: (db: never, input: Parameters<typeof actual.tellPartyNotBooked>[1]) =>
      actual.tellPartyNotBooked(db, input, { provider: mail.current?.provider }),
  };
});

const { eq } = await import("drizzle-orm");
const { bookings, people } = await import("@/db/schema");
const { createTrip } = await import("@/db/trips-create");
const { HOUR_MS, nowDate } = await import("@/lib/clock");
const { log } = await import("@/lib/log");
const { messageFor } = await import("@/lib/notifications/render");
const { bookSpot } = await import("./actions");

async function freeDeparture() {
  const { db, shop } = ctx;
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Free Two-Tank",
    startsAt: new Date(now.getTime() + 72 * HOUR_MS),
    endsAt: new Date(now.getTime() + 76 * HOUR_MS),
    capacity: 12,
    plannedDives: 2,
  });
  if (!trip) throw new Error("test trip could not be created");
  return trip.id;
}

function submission(party: Array<{ name: string; email: string }>): FormData {
  const form = new FormData();
  form.set("partySize", String(party.length));
  party.forEach((member, index) => {
    form.set(`fullName-${index}`, member.name);
    form.set(`email-${index}`, member.email);
  });
  return form;
}

/**
 * One submission: where it landed (or the state it handed back), and what the
 * deferred work then mailed. The deferred work runs after the answer exists,
 * exactly as `after()` runs it.
 */
async function post(tripId: string, party: Array<{ name: string; email: string }>) {
  pending.length = 0;
  mail.current = fakeEmail();
  let landed: string | null = null;
  let state: unknown = null;
  try {
    state = await bookSpot(
      { shopSlug: ctx.shop.slug, tripId, embed: false },
      {},
      submission(party),
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("REDIRECT:")) throw error;
    landed = error.message.slice("REDIRECT:".length);
  }
  for (const task of pending.splice(0)) await task();
  return { landed, state, sent: mail.current.sent };
}

async function seatEmails(tripId: string) {
  const rows = await ctx.db
    .select({ email: people.email })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(eq(bookings.tripId, tripId));
  return rows.map((row) => row.email).sort();
}

const NEUTRAL = (tripId: string) => `/s/${ctx.shop.slug}/trips/${tripId}?sent=1`;

describe("the public booking form, for an address that already holds a seat", () => {
  it("lands a repeat on the neutral page and tells only the holder", async () => {
    const tripId = await freeDeparture();
    const fresh = await post(tripId, [{ name: "Nora Diaz", email: "nora@example.com" }]);
    expect(fresh.landed).toMatch(/^\/ready\/.+\?booked=1$/);

    const repeat = await post(tripId, [{ name: "Anyone", email: "NORA@example.com" }]);
    expect(repeat.state).toBeNull();
    expect(repeat.landed).toBe(NEUTRAL(tripId));
    expect(repeat.sent.map((m) => [m.kind, m.to])).toEqual([
      ["seat_already_held", "nora@example.com"],
    ]);
    expect(await seatEmails(tripId)).toEqual(["nora@example.com"]);
  });

  it("lands a rolled-back party on the same page, naming nobody", async () => {
    const tripId = await freeDeparture();
    await post(tripId, [{ name: "Nora Diaz", email: "nora@example.com" }]);

    const party = await post(tripId, [
      { name: "Lena Lead", email: "lena@example.com" },
      { name: "Nora Diaz", email: "nora@example.com" },
      { name: "Sam Third", email: "sam@example.com" },
    ]);
    expect(party.state).toBeNull();
    expect(party.landed).toBe(NEUTRAL(tripId));
    // Nothing booked: the data layer still refuses the double seat, and the party with it.
    expect(await seatEmails(tripId)).toEqual(["nora@example.com"]);

    // The holder hears about her seat; the lead hears the outcome; the third, nothing.
    expect(party.sent.map((m) => [m.kind, m.to]).sort()).toEqual([
      ["party_not_booked", "lena@example.com"],
      ["seat_already_held", "nora@example.com"],
    ]);
    const toLead = party.sent.find((m) => m.kind === "party_not_booked");
    expect(JSON.stringify(toLead)).not.toMatch(/nora|diaz/i);
  });

  it("mails the lead the same words whatever rolled the party back", async () => {
    // Security review of #2691: lead = the prober's own address, member = the
    // address probed. A booked member and a party that clashes with itself
    // (the same address twice) must read identically in the lead's inbox.
    const tripId = await freeDeparture();
    await post(tripId, [{ name: "Nora Diaz", email: "nora@example.com" }]);
    const rendered = (sent: Awaited<ReturnType<typeof post>>["sent"]) =>
      sent.filter((m) => m.kind === "party_not_booked").map((m) => messageFor(m));

    const booked = await post(tripId, [
      { name: "Lena Lead", email: "lena@example.com" },
      { name: "Nora Diaz", email: "nora@example.com" },
    ]);
    const clashing = await post(tripId, [
      { name: "Lena Lead", email: "lena@example.com" },
      { name: "Kim Twice", email: "kim@example.com" },
      { name: "Kim Twice", email: "kim@example.com" },
    ]);
    expect(clashing.landed).toBe(booked.landed);
    expect(rendered(booked.sent)).toHaveLength(1);
    expect(rendered(clashing.sent)).toEqual(rendered(booked.sent));
    // And the address nobody holds a seat under hears nothing.
    expect(clashing.sent.map((m) => m.to)).toEqual(["lena@example.com"]);
  });

  it("still mails the lead when finding the held seat fails", async () => {
    const tripId = await freeDeparture();
    await post(tripId, [{ name: "Nora Diaz", email: "nora@example.com" }]);
    heldSeatFails.current = true;
    try {
      const party = await post(tripId, [
        { name: "Lena Lead", email: "lena@example.com" },
        { name: "Nora Diaz", email: "nora@example.com" },
      ]);
      expect(party.landed).toBe(NEUTRAL(tripId));
      expect(party.sent.map((m) => [m.kind, m.to])).toEqual([
        ["party_not_booked", "lena@example.com"],
      ]);
      expect(vi.mocked(log)).toHaveBeenCalledWith(
        "already_held.failed",
        "error",
        expect.not.objectContaining({ email: expect.anything() }),
      );
      expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toMatch(/@example\.com/);
    } finally {
      heldSeatFails.current = false;
    }
  });

  it("answers a repeat and a rolled-back party with the same page as each other", async () => {
    const tripId = await freeDeparture();
    await post(tripId, [{ name: "Nora Diaz", email: "nora@example.com" }]);
    const repeat = await post(tripId, [{ name: "Nora Diaz", email: "nora@example.com" }]);
    const party = await post(tripId, [
      { name: "Lena Lead", email: "lena@example.com" },
      { name: "Nora Diaz", email: "nora@example.com" },
    ]);
    expect(repeat.landed).toBe(party.landed);
  });

  it("mails nothing for a party that fails for any other reason, and keeps its refusal", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "One Seat",
      startsAt: new Date(now.getTime() + 72 * HOUR_MS),
      endsAt: new Date(now.getTime() + 76 * HOUR_MS),
      capacity: 1,
      plannedDives: 2,
    });
    if (!trip) throw new Error("test trip could not be created");
    await post(trip.id, [{ name: "First In", email: "first@example.com" }]);
    const full = await post(trip.id, [{ name: "Lena Lead", email: "lena@example.com" }]);
    expect(full.landed).toBeNull();
    expect(full.state).toMatchObject({ error: expect.any(String) });
    expect(full.sent).toEqual([]);
  });
});
