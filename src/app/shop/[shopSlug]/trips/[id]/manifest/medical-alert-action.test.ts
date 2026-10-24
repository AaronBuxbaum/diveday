import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { activityEvents, tripAssignments, trips, waiverRecords } from "@/db/schema";
import { completeWaiver } from "@/db/waivers-completion";
import { issueWaiverRequest } from "@/db/waivers-requests";
import { clearAnswers, now, waiverContextFor } from "@/db/waivers-test-fixtures";
import { MINUTE_MS, nowDate } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// The request's own headers, per test: the emergency read refuses a cross-site call.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// The real writer, wrapped so one test can make the trail refuse the line.
vi.mock("@/db/operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/operations")>();
  return { ...actual, recordDiverActivity: vi.fn(actual.recordDiverActivity) };
});
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { recordDiverActivity } = await import("@/db/operations");
const { emergencyShowSeatMedicalAlertAction, showSeatMedicalAlertAction } = await import(
  "./medical-alert-action"
);

const ctx = fileScopedShopContext();
const waiverContext = waiverContextFor(ctx);
const ALERT = "Bee-sting allergy. EpiPen in the blue dry bag.";

/**
 * **Opening a medical alert on the manifest** (issue #2960): the owner, a
 * manager, or this departure's crew; each read on the diver's trail first.
 */
async function alerted() {
  const context = await waiverContext();
  const { db, shop, booking, person } = context;
  vi.mocked(getDb).mockResolvedValue(db);
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
  if (!issued.ok) throw new Error("expected a waiver link");
  const signed = await completeWaiver(db, issued.token, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: clearAnswers,
    medicalAlert: ALERT,
    now,
  });
  if (!signed.ok) throw new Error("expected a signature");
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  // Off this departure's crew to start; each test puts them on when it needs.
  await db
    .delete(tripAssignments)
    .where(and(eq(tripAssignments.tripId, context.trip.id), eq(tripAssignments.personId, captain)));
  return {
    ...context,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain,
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

async function readLines(
  db: Awaited<ReturnType<typeof alerted>>["db"],
  personId: string,
  code: "medical_alert_read" | "medical_alert_emergency_read" = "medical_alert_read",
) {
  return db
    .select({ actor: activityEvents.actorPersonId })
    .from(activityEvents)
    .where(and(eq(activityEvents.subjectPersonId, personId), eq(activityEvents.code, code)));
}

describe("showSeatMedicalAlertAction", () => {
  it("hands the owner the words and puts the read on the diver's trail", async () => {
    const { db, shop, trip, booking, person, owner } = await alerted();
    signIn(shop, owner);
    await expect(showSeatMedicalAlertAction(shop.slug, trip.id, booking.id)).resolves.toEqual({
      ok: true,
      text: ALERT,
    });
    expect(await readLines(db, person.id)).toEqual([{ actor: owner }]);
  });

  it("hands them to a captain a manager put on this departure, and refuses them off it or self-rostered", async () => {
    const { db, shop, trip, booking, person, captain, owner } = await alerted();
    signIn(shop, captain);
    await expect(showSeatMedicalAlertAction(shop.slug, trip.id, booking.id)).resolves.toEqual({
      ok: false,
    });
    expect(await readLines(db, person.id)).toEqual([]);
    // Rostered by themselves: still refused.
    await db
      .insert(tripAssignments)
      .values({ tripId: trip.id, personId: captain, assignedByPersonId: captain });
    await expect(showSeatMedicalAlertAction(shop.slug, trip.id, booking.id)).resolves.toEqual({
      ok: false,
    });
    await db
      .update(tripAssignments)
      .set({ assignedByPersonId: owner })
      .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.personId, captain)));
    await expect(showSeatMedicalAlertAction(shop.slug, trip.id, booking.id)).resolves.toEqual({
      ok: true,
      text: ALERT,
    });
    expect(await readLines(db, person.id)).toEqual([{ actor: captain }]);
  });

  it("refuses a seat that is not on the departure named, even to its crew", async () => {
    const { db, shop, trip, booking, person, captain, owner } = await alerted();
    const [other] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), ne(trips.id, trip.id)))
      .limit(1);
    if (!other) throw new Error("expected a second seeded departure");
    const elsewhere = other.id;
    await db
      .insert(tripAssignments)
      .values({ tripId: elsewhere, personId: captain, assignedByPersonId: owner })
      .onConflictDoNothing();
    signIn(shop, captain);
    // Crewing another departure and naming it with this seat reads nothing.
    await expect(showSeatMedicalAlertAction(shop.slug, elsewhere, booking.id)).resolves.toEqual({
      ok: false,
    });
    expect(await readLines(db, person.id)).toEqual([]);
  });

  it("writes one read per reader, diver and departure within ten minutes, and shows the words every time", async () => {
    const { db, shop, trip, booking, person, owner } = await alerted();
    signIn(shop, owner);
    for (let tap = 0; tap < 3; tap++) {
      await expect(showSeatMedicalAlertAction(shop.slug, trip.id, booking.id)).resolves.toEqual({
        ok: true,
        text: ALERT,
      });
      advanceClock(3 * MINUTE_MS);
    }
    expect(await readLines(db, person.id)).toHaveLength(1);
    // Past ten minutes after the first line, the next tap is a new read.
    advanceClock(2 * MINUTE_MS);
    await expect(showSeatMedicalAlertAction(shop.slug, trip.id, booking.id)).resolves.toEqual({
      ok: true,
      text: ALERT,
    });
    expect(await readLines(db, person.id)).toHaveLength(2);
  });

  it("shows nothing when the trail cannot take the line", async () => {
    const { db, shop, trip, booking, person, owner } = await alerted();
    signIn(shop, owner);
    vi.mocked(recordDiverActivity).mockResolvedValueOnce(false);
    await expect(showSeatMedicalAlertAction(shop.slug, trip.id, booking.id)).resolves.toEqual({
      ok: false,
    });
    expect(await readLines(db, person.id)).toEqual([]);
  });

  it("answers nothing for a seat whose release carries none", async () => {
    const { db, shop, trip, booking, person, owner } = await alerted();
    await db
      .update(waiverRecords)
      .set({ medicalAlert: null })
      .where(eq(waiverRecords.personId, person.id));
    signIn(shop, owner);
    await expect(showSeatMedicalAlertAction(shop.slug, trip.id, booking.id)).resolves.toEqual({
      ok: false,
    });
    await expect(showSeatMedicalAlertAction(shop.slug, trip.id, "not-a-uuid")).resolves.toEqual({
      ok: false,
    });
    expect(await readLines(db, person.id)).toEqual([]);
  });

  it("refuses another shop's slug before reading anything", async () => {
    const { db, shop, trip, booking, person, owner } = await alerted();
    signIn(shop, owner);
    await expect(showSeatMedicalAlertAction("another-shop", trip.id, booking.id)).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(await readLines(db, person.id)).toEqual([]);
  });
});

/**
 * **"Emergency: show the alert"** (issue #2990): a staffer the crew rule
 * refuses, on the day only, every confirm on the diver's trail.
 */
describe("emergencyShowSeatMedicalAlertAction", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function leavingAt(
    db: Awaited<ReturnType<typeof alerted>>["db"],
    tripId: string,
    at: Date,
  ) {
    await db
      .update(trips)
      .set({ startsAt: at, endsAt: new Date(at.getTime() + 4 * 60 * 60 * 1000) })
      .where(eq(trips.id, tripId));
  }

  it("hands a captain off the crew the words today and records both of two reads in a row", async () => {
    request.headers = new Headers();
    const { db, shop, trip, booking, person, captain } = await alerted();
    await leavingAt(db, trip.id, nowDate());
    signIn(shop, captain);
    for (let read = 0; read < 2; read++) {
      await expect(
        emergencyShowSeatMedicalAlertAction(shop.slug, trip.id, booking.id),
      ).resolves.toEqual({ ok: true, text: ALERT });
    }
    expect(await readLines(db, person.id, "medical_alert_emergency_read")).toEqual([
      { actor: captain },
      { actor: captain },
    ]);
    // The ordinary read is still refused, and wrote nothing.
    await expect(showSeatMedicalAlertAction(shop.slug, trip.id, booking.id)).resolves.toEqual({
      ok: false,
    });
    expect(await readLines(db, person.id)).toEqual([]);
  });

  it("refuses tomorrow and yesterday", async () => {
    request.headers = new Headers();
    const { db, shop, trip, booking, person, captain } = await alerted();
    signIn(shop, captain);
    for (const offset of [DAY_MS, -DAY_MS]) {
      await leavingAt(db, trip.id, new Date(nowDate().getTime() + offset));
      await expect(
        emergencyShowSeatMedicalAlertAction(shop.slug, trip.id, booking.id),
      ).resolves.toEqual({ ok: false });
    }
    expect(await readLines(db, person.id, "medical_alert_emergency_read")).toEqual([]);
  });

  it("refuses a call from another site before reading anything", async () => {
    const { db, shop, trip, booking, person, captain } = await alerted();
    await leavingAt(db, trip.id, nowDate());
    signIn(shop, captain);
    for (const headers of [
      new Headers({ "sec-fetch-site": "cross-site" }),
      new Headers({ origin: "https://evil.example", host: "app.diveday.test" }),
      new Headers({ origin: "null", host: "app.diveday.test" }),
    ]) {
      request.headers = headers;
      await expect(
        emergencyShowSeatMedicalAlertAction(shop.slug, trip.id, booking.id),
      ).resolves.toEqual({ ok: false });
    }
    // The same call from the app's own origin goes through.
    request.headers = new Headers({ origin: "https://app.diveday.test", host: "app.diveday.test" });
    await expect(
      emergencyShowSeatMedicalAlertAction(shop.slug, trip.id, booking.id),
    ).resolves.toEqual({ ok: true, text: ALERT });
    expect(await readLines(db, person.id, "medical_alert_emergency_read")).toHaveLength(1);
    request.headers = new Headers();
  });

  it("refuses a caller with no staff session, as a bearer page has none", async () => {
    request.headers = new Headers();
    const { db, shop, trip, booking, person } = await alerted();
    await leavingAt(db, trip.id, nowDate());
    vi.mocked(requireStaffSession).mockRejectedValueOnce(new Error("REDIRECT:/sign-in"));
    await expect(
      emergencyShowSeatMedicalAlertAction(shop.slug, trip.id, booking.id),
    ).rejects.toThrow("REDIRECT:/sign-in");
    expect(await readLines(db, person.id, "medical_alert_emergency_read")).toEqual([]);
  });

  it("refuses another shop's slug, a junk id and a trail that cannot take the line", async () => {
    request.headers = new Headers();
    const { db, shop, trip, booking, person, captain } = await alerted();
    await leavingAt(db, trip.id, nowDate());
    signIn(shop, captain);
    await expect(
      emergencyShowSeatMedicalAlertAction("another-shop", trip.id, booking.id),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      emergencyShowSeatMedicalAlertAction(shop.slug, trip.id, "not-a-uuid"),
    ).resolves.toEqual({ ok: false });
    vi.mocked(recordDiverActivity).mockResolvedValueOnce(false);
    await expect(
      emergencyShowSeatMedicalAlertAction(shop.slug, trip.id, booking.id),
    ).resolves.toEqual({ ok: false });
    expect(await readLines(db, person.id, "medical_alert_emergency_read")).toEqual([]);
  });
});
