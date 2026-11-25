import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { issueDiverSignIn, startDiverSession } from "@/db/diver-sign-in";
import { getBookingPayment } from "@/db/payments";
import { createPerson } from "@/db/people";
import { bookings, shops } from "@/db/schema";
import { createTrip } from "@/db/trips-create";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

/**
 * ADR 20261125-diver-sign-in: a signed-in diver's trip credit settles the seat
 * the booking form just booked, once, however often the form is resubmitted;
 * a session that is not the seat's person spends nothing, and the booking
 * goes on as it always did. The real action on a real database; only the
 * framework edge is stubbed, and the cookie jar holds the diver's session.
 */
const ctx = fileScopedShopContext();
const jar = vi.hoisted(() => ({ session: undefined as string | undefined }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "diveday_diver" && jar.session ? { value: jar.session } : undefined,
  })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/features/platform/sentry-server", () => ({ sentry: { captureException: vi.fn() } }));
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US" as const),
  requestFirstHandLocale: vi.fn(async () => "en-US" as const),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { getDb } = await import("@/db/client");
const { redirect } = await import("next/navigation");
const { bookSpot } = await import("./actions");
const { grantTripCredit, readTripCredit } = await import("@/features/money/trip-credit");

async function setting(db: AppDb) {
  vi.mocked(getDb).mockResolvedValue(db);
  await db
    .update(shops)
    .set({ currency: "usd", taxEnabled: false, passThroughFee: null })
    .where(eq(shops.id, ctx.shop.id));
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId: ctx.shop.id,
    title: "Credit Two-Tank",
    startsAt: new Date(now.getTime() + 72 * HOUR_MS),
    endsAt: new Date(now.getTime() + 76 * HOUR_MS),
    capacity: 12,
    plannedDives: 2,
    priceCents: 10_000,
  });
  if (!trip) throw new Error("test trip could not be created");
  return { tripId: trip.id };
}

async function diverWithCredit(db: AppDb, name: string, cents: number, actorPersonId: string) {
  const person = await createPerson(db, {
    shopId: ctx.shop.id,
    fullName: name,
    email: `${randomUUID()}@example.com`,
    phone: null,
    origin: "counter",
  });
  if (cents > 0) {
    const granted = await grantTripCredit(db, {
      shopId: ctx.shop.id,
      personId: person.id,
      actorPersonId,
      attemptId: randomUUID(),
      currency: "usd",
      amountCents: cents,
      reason: "goodwill",
    });
    expect(granted.ok).toBe(true);
  }
  const issued = await issueDiverSignIn(db, { shopId: ctx.shop.id, email: person.email ?? "" });
  const session = await startDiverSession(db, { token: issued?.token ?? "" });
  return { person, sessionToken: session?.token };
}

async function ownerId(db: AppDb) {
  const { people, personRoles } = await import("@/db/schema");
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, ctx.shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!row) throw new Error("expected the seeded owner");
  return row.id;
}

function form(lead: { fullName: string; email: string }, attempt: string) {
  const data = new FormData();
  data.set("partySize", "1");
  data.set("fullName-0", lead.fullName);
  data.set("email-0", lead.email);
  data.set("useTripCredit", "on");
  data.set("tripCreditAttempt", attempt);
  return data;
}

async function post(tripId: string, data: FormData) {
  try {
    return await bookSpot({ shopSlug: ctx.shop.slug, tripId }, {}, data);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT:")) return error.message;
    throw error;
  }
}

async function seatOf(db: AppDb, tripId: string, personId: string) {
  const [seat] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), eq(bookings.personId, personId)));
  return seat;
}

describe("trip credit on the booking form", () => {
  it("spends once however often the form is resubmitted", async () => {
    const { db } = ctx;
    const { tripId } = await setting(db);
    const ana = await diverWithCredit(db, "Ana Credit", 15_000, await ownerId(db));
    jar.session = ana.sessionToken;
    const data = form({ fullName: "Ana Credit", email: ana.person.email ?? "" }, randomUUID());

    expect(await post(tripId, data)).toMatch(/^REDIRECT:\/ready\//);
    const seat = await seatOf(db, tripId, ana.person.id);
    expect((await getBookingPayment(db, ctx.shop.id, seat?.id ?? ""))?.status).toBe("paid");
    expect((await readTripCredit(db, ctx.shop.id, ana.person.id, "usd")).balanceCents).toBe(5_000);

    await post(tripId, data);
    await post(tripId, data);
    expect((await readTripCredit(db, ctx.shop.id, ana.person.id, "usd")).balanceCents).toBe(5_000);
    expect(vi.mocked(redirect)).toHaveBeenCalled();
  });

  it("refuses for someone else's booking and books it as the form always has", async () => {
    const { db } = ctx;
    const { tripId } = await setting(db);
    const actor = await ownerId(db);
    const stranger = await diverWithCredit(db, "Sam Stranger", 15_000, actor);
    const ben = await diverWithCredit(db, "Ben Booked", 0, actor);
    jar.session = stranger.sessionToken;

    await post(
      tripId,
      form({ fullName: "Ben Booked", email: ben.person.email ?? "" }, randomUUID()),
    );
    const seat = await seatOf(db, tripId, ben.person.id);
    expect(seat?.status).toBe("booked");
    const payment = await getBookingPayment(db, ctx.shop.id, seat?.id ?? "");
    expect(payment?.status ?? "unpaid").toBe("unpaid");
    expect((await readTripCredit(db, ctx.shop.id, stranger.person.id, "usd")).balanceCents).toBe(
      15_000,
    );
  });

  it("books and pays as usual with nobody signed in", async () => {
    const { db } = ctx;
    const { tripId } = await setting(db);
    const ana = await diverWithCredit(db, "Ana Signed Out", 15_000, await ownerId(db));
    jar.session = undefined;
    await post(
      tripId,
      form({ fullName: "Ana Signed Out", email: ana.person.email ?? "" }, randomUUID()),
    );
    const seat = await seatOf(db, tripId, ana.person.id);
    expect(seat?.status).toBe("booked");
    expect((await readTripCredit(db, ctx.shop.id, ana.person.id, "usd")).balanceCents).toBe(15_000);
  });
});
