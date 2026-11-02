import { and, eq, gt, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { assignHelpRequestHelper, getHelpRequestForBooking } from "@/db/help-requests";
import { getReadyPageData } from "@/db/ready";
import { bookings, shops, trips } from "@/db/schema";
import { getTripCrewAssignments, listStaff } from "@/db/trips";
import { DAY_MS, nowDate } from "@/lib/clock";
import { DIETARY_NOTE_MAX } from "@/lib/lunch-aboard";
import { fileScopedShopContext } from "@/test/db";

/**
 * **Day-of details, one Save** (third UX review, item 24), against a real
 * database. Six forms became one, so what has to hold is that every answer
 * lands together, that an answer left alone is not rewritten (a help request
 * the crew acknowledged keeps its status), that "Choose" never blanks, and
 * that the gates the six actions each re-derived still hold.
 */

const fileCtx = fileScopedShopContext();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US"),
  requestFirstHandLocale: vi.fn(async () => null),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { getDb } = await import("@/db/client");
const { saveDayOfDetailsFromReady } = await import("./day-of-actions");

afterEach(() => vi.clearAllMocks());

/** A booked diver more than a day out, with a readiness link. */
async function seat() {
  const { db, shop } = fileCtx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [row] = await db
    .select({ bookingId: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        eq(bookings.status, "booked"),
        eq(bookings.participantType, "diver"),
        ne(trips.status, "cancelled"),
        // More than a day out, so D18's offer window is open.
        gt(trips.startsAt, new Date(nowDate().getTime() + 2 * DAY_MS)),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!row) throw new Error("seed has no booked diver");
  // The seat, freed of anything the seed said, so each case starts blank.
  await db
    .update(bookings)
    .set({
      lastDivedBand: null,
      diveIntent: null,
      reEntryAsk: null,
      hotelPickupLocation: null,
      dietaryNote: null,
      identityUnconfirmedAt: null,
      participantType: "diver",
    })
    .where(eq(bookings.id, row.bookingId));
  const issued = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: row.bookingId,
    purpose: "readiness",
  });
  if (!issued) throw new Error("no readiness link");
  return { db, shop, bookingId: row.bookingId, token: issued.token };
}

async function save(token: string, fields: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  try {
    await saveDayOfDetailsFromReady(token, formData);
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
  return "";
}

async function read(bookingId: string) {
  const data = await getReadyPageData(fileCtx.db, bookingId);
  if (!data) throw new Error("ready data missing");
  return data;
}

/** A seat whose diver has never been aboard before, so the first-trip question is asked. */
async function firstTimerSeat() {
  const made = await seat();
  const { db } = made;
  const [own] = await db
    .select({ personId: bookings.personId, tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, made.bookingId));
  if (!own) throw new Error("seat vanished");
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(bookings.personId, own.personId),
        ne(bookings.id, made.bookingId),
        ne(bookings.status, "cancelled"),
      ),
    );
  await db
    .update(bookings)
    .set({ welcomeSharedAt: null, welcomeHello: null })
    .where(eq(bookings.id, made.bookingId));
  expect((await read(made.bookingId)).welcomeOffer).toEqual({ kind: "first_trip" });
  return made;
}

describe("the first-timer's word to the crew", () => {
  it("keeps the choice with the yes, changes it, and clears it with the consent", async () => {
    const { bookingId, token } = await firstTimerSeat();
    await save(token, { welcomeAsked: "1", welcomeShare: "on", welcomeHello: "celebrating" });
    expect(await read(bookingId)).toMatchObject({
      welcomeShared: true,
      welcomeHello: "celebrating",
    });

    await save(token, { welcomeAsked: "1", welcomeShare: "on", welcomeHello: "nervous" });
    expect((await read(bookingId)).welcomeHello).toBe("nervous");

    await save(token, { welcomeAsked: "1", welcomeShare: "on", welcomeHello: "" });
    expect(await read(bookingId)).toMatchObject({ welcomeShared: true, welcomeHello: null });

    await save(token, { welcomeAsked: "1", welcomeShare: "on", welcomeHello: "nervous" });
    await save(token, { welcomeAsked: "1", welcomeHello: "nervous" });
    expect(await read(bookingId)).toMatchObject({ welcomeShared: false, welcomeHello: null });
  });

  /**
   * Visual review 2026-10-24, B27: the thread no longer asks for the word, so
   * a save that does not carry the field leaves a word on file where it was.
   * Withdrawing the yes still clears it.
   */
  it("leaves a stored word alone when the save does not carry the field", async () => {
    const { bookingId, token } = await firstTimerSeat();
    await save(token, { welcomeAsked: "1", welcomeShare: "on", welcomeHello: "celebrating" });
    await save(token, { welcomeAsked: "1", welcomeShare: "on", note: "Left ear is slow." });
    expect(await read(bookingId)).toMatchObject({
      welcomeShared: true,
      welcomeHello: "celebrating",
    });
    await save(token, { welcomeAsked: "1" });
    expect(await read(bookingId)).toMatchObject({ welcomeShared: false, welcomeHello: null });
  });

  it("refuses a choice outside the three, and stores nothing without the yes", async () => {
    const { bookingId, token } = await firstTimerSeat();
    expect(
      await save(token, { welcomeAsked: "1", welcomeShare: "on", welcomeHello: "I have asthma" }),
    ).toBe(`REDIRECT:/ready/${token}?error=day-of`);
    await save(token, { welcomeAsked: "1", welcomeHello: "nervous" });
    expect(await read(bookingId)).toMatchObject({ welcomeShared: false, welcomeHello: null });
  });
});

describe("saveDayOfDetailsFromReady", () => {
  it("keeps every answer from one Save, not only the last", async () => {
    const { bookingId, token } = await seat();
    const to = await save(token, {
      lastDivedBand: "within_a_year",
      diveIntent: "small_life",
      note: "Left ear is slow to clear.",
      hotelPickupLocation: "Marriott, room 214",
      kind: "carry_gear",
    });
    expect(to).toBe(`REDIRECT:/ready/${token}?saved=day-of`);
    const data = await read(bookingId);
    expect(data.lastDivedBand).toBe("within_a_year");
    expect(data.diveIntent).toBe("small_life");
    expect(data.rentalFit?.note).toBe("Left ear is slow to clear.");
    expect(data.hotelPickupLocation).toBe("Marriott, room 214");
    expect(data.helpRequest?.kind).toBe("carry_gear");
  });

  // Security review N5 of layer r4-1: the page hides the field at a shop
  // that runs no pickups, and the server keeps it hidden from a hand-made post.
  it("stores no pickup location at a shop that runs no pickups", async () => {
    const { db, shop, bookingId, token } = await seat();
    await db.update(shops).set({ offersHotelPickup: false }).where(eq(shops.id, shop.id));
    await save(token, { hotelPickupLocation: "Marriott, room 214" });
    expect((await read(bookingId)).hotelPickupLocation).toBeNull();
  });

  it("takes no new help request while help requests are off, and keeps an open one", async () => {
    const { db, shop, bookingId, token } = await seat();
    await save(token, { kind: "first_timer" });
    await db.update(shops).set({ helpRequestsEnabled: false }).where(eq(shops.id, shop.id));
    // A hand-built post changing the ask is refused and the open request stands.
    expect(await save(token, { kind: "carry_gear" })).toContain("error=day-of");
    expect((await read(bookingId)).helpRequest).toMatchObject({
      kind: "first_timer",
      status: "requested",
    });
    // Withdrawn, a new one is refused too.
    await save(token, { kind: "none" });
    expect(await save(token, { kind: "carry_gear" })).toContain("error=day-of");
    expect((await read(bookingId)).helpRequest).toBeNull();
  });

  it("asks for a lunch preference only on a boat that serves lunch, and clears it with a blank", async () => {
    const { db, bookingId, token } = await seat();
    const [own] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    await db.update(trips).set({ lunchAboard: false }).where(eq(trips.id, own.tripId));
    await save(token, { dietaryNote: "no shellfish" });
    expect((await read(bookingId)).dietaryNote).toBeNull();

    await db.update(trips).set({ lunchAboard: true }).where(eq(trips.id, own.tripId));
    expect(await save(token, { dietaryNote: "  no   shellfish " })).toBe(
      `REDIRECT:/ready/${token}?saved=day-of`,
    );
    expect((await read(bookingId)).dietaryNote).toBe("no shellfish");
    await save(token, { dietaryNote: "" });
    expect((await read(bookingId)).dietaryNote).toBeNull();
  });

  it("holds a hand-posted lunch note to the same 160 characters the input allows", async () => {
    const { db, bookingId, token } = await seat();
    const [own] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    await db.update(trips).set({ lunchAboard: true }).where(eq(trips.id, own.tripId));
    await save(token, { dietaryNote: "v".repeat(DIETARY_NOTE_MAX + 1) });
    expect((await read(bookingId)).dietaryNote).toBeNull();
    await save(token, { dietaryNote: "v".repeat(DIETARY_NOTE_MAX) });
    expect((await read(bookingId)).dietaryNote).toBe("v".repeat(DIETARY_NOTE_MAX));
  });

  it("never blanks a stored answer with Choose", async () => {
    const { bookingId, token } = await seat();
    await save(token, { lastDivedBand: "this_season", diveIntent: "a_wreck" });
    await save(token, { lastDivedBand: "", diveIntent: "" });
    const data = await read(bookingId);
    expect(data.lastDivedBand).toBe("this_season");
    expect(data.diveIntent).toBe("a_wreck");
  });

  it("does not rewrite a help request left as it was, so the crew's acknowledgment stands", async () => {
    const { db, shop, bookingId, token } = await seat();
    await save(token, { kind: "first_timer" });
    const request = await getHelpRequestForBooking(db, shop.id, bookingId);
    const [staff] = await listStaff(db, shop.id);
    if (!request || !staff) throw new Error("setup missing");
    const [assignment] = await getTripCrewAssignments(db, shop.id, request.tripId);
    if (!assignment) throw new Error("departure crew missing");
    await assignHelpRequestHelper(db, {
      shopId: shop.id,
      requestId: request.id,
      expectedRevision: request.revision,
      helperPersonId: assignment.personId,
      actorPersonId: staff.person.id,
      expectedStatus: "requested",
    });
    // The whole form posts again, the help radio unchanged, to save a note.
    await save(token, { kind: "first_timer", note: "Bringing my own computer." });
    expect((await read(bookingId)).helpRequest?.status).toBe("acknowledged");
  });

  it("asks a seat that is not diving nothing about diving, whatever the post says", async () => {
    const { db, bookingId, token } = await seat();
    await db.update(bookings).set({ participantType: "rider" }).where(eq(bookings.id, bookingId));
    await save(token, {
      lastDivedBand: "never",
      diveIntent: "skills",
      hotelPickupLocation: "Pier 1",
    });
    const data = await read(bookingId);
    expect(data.lastDivedBand).toBeNull();
    expect(data.diveIntent).toBeNull();
    expect(data.hotelPickupLocation).toBe("Pier 1");
  });

  it("takes a re-entry ask only while the saved intent opens it", async () => {
    const { db, bookingId, token } = await seat();
    await save(token, { diveIntent: "easing_back" });
    // Moving the intent away in the same post closes the offer it opened.
    await save(token, { diveIntent: "good_day", reEntryAsk: "deck_word" });
    expect((await read(bookingId)).reEntryAsk).toBeNull();
    await db.update(bookings).set({ diveIntent: "easing_back" }).where(eq(bookings.id, bookingId));
    await save(token, { diveIntent: "easing_back", reEntryAsk: "deck_word" });
    expect((await read(bookingId)).reEntryAsk).toBe("deck_word");
  });

  it("refuses a post it cannot read, and writes nothing", async () => {
    const { bookingId, token } = await seat();
    expect(await save(token, { lastDivedBand: "yesterday", note: "x" })).toBe(
      `REDIRECT:/ready/${token}?error=day-of`,
    );
    expect((await read(bookingId)).rentalFit?.note ?? null).toBeNull();
  });
});
