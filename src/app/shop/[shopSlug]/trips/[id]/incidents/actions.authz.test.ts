import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import {
  fileIncidentReport,
  saveIncidentDraft,
  startIncidentReport,
  startMissingDiverReport,
} from "@/db/incident-reports";
import { complete } from "@/db/incident-reports-test-fixtures";
import { bookings, incidentReports, rollCallEvents, tripAssignments, trips } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * The incident report's actions run the real database writes under a mocked
 * session, so these check what the action does for somebody who is staff but
 * may not touch this report — the row afterwards, not only the redirect (ADR
 * 20261012-incident-reports).
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const {
  deleteIncidentDraftAction,
  saveIncidentDraftAction,
  startIncidentReportAction,
  startMissingDiverReportAction,
} = await import("./actions");

/** A booked departure with the captain taken off its crew, so the captain is ashore. */
async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .innerJoin(bookings, eq(bookings.tripId, trips.id))
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!trip) throw new Error("seeded shop has no booked departure");
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  await db
    .delete(tripAssignments)
    .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.personId, captain)));
  return { db, shop, tripId: trip.id, owner, captain };
}

function signIn(db: AppDb, shop: { id: string; slug: string }, personId: string) {
  const session = staffSession({ shopId: shop.id, shopSlug: shop.slug, personId });
  vi.mocked(requireShopSurface).mockResolvedValue({
    session,
    db,
    shop: ctx.shop,
  } as unknown as Awaited<ReturnType<typeof requireShopSurface>>);
}

async function reportCount(db: AppDb, tripId: string) {
  return (await db.select().from(incidentReports).where(eq(incidentReports.tripId, tripId))).length;
}

function draftForm(): FormData {
  const form = new FormData();
  form.set("whatHappened", "Written by someone who was not there.");
  return form;
}

describe("incident report actions refuse staff who may not write", () => {
  it("sends an ashore captain back with a refusal and writes no report", async () => {
    const { db, shop, tripId, captain } = await context();
    signIn(db, shop, captain);
    const before = await reportCount(db, tripId);
    const to = await redirectedTo(() => startIncidentReportAction(shop.slug, tripId));
    expect(to).toContain("notice=not-authorized");
    expect(await reportCount(db, tripId)).toBe(before);
  });

  it("answers an ashore captain saving an owner's draft as if it did not exist", async () => {
    const { db, shop, tripId, owner, captain } = await context();
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId,
      actorPersonId: owner,
    });
    if (!started.ok) throw new Error("expected the owner's draft");
    signIn(db, shop, captain);
    await expect(
      saveIncidentDraftAction(shop.slug, tripId, started.reportId, draftForm()),
    ).rejects.toThrow("NOT_FOUND");
    const [row] = await db
      .select({ whatHappened: incidentReports.whatHappened })
      .from(incidentReports)
      .where(eq(incidentReports.id, started.reportId));
    expect(row?.whatHappened).toBeNull();
  });

  it("answers an owner writing under another departure's address as if it did not exist", async () => {
    const { db, shop, tripId, owner } = await context();
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId,
      actorPersonId: owner,
    });
    if (!started.ok) throw new Error("expected the owner's draft");
    const [other] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), ne(trips.id, tripId)))
      .limit(1);
    if (!other) throw new Error("expected a second departure");
    signIn(db, shop, owner);
    await expect(
      saveIncidentDraftAction(shop.slug, other.id, started.reportId, draftForm()),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("answers an ashore captain's missing diver report in words, writing nothing", async () => {
    const { db, shop, tripId, owner, captain } = await context();
    const bookingId = await markedMissing(db, shop.id, tripId, owner);
    signIn(db, shop, captain);
    const before = await reportCount(db, tripId);
    expect(
      await startMissingDiverReportAction(shop.slug, tripId, null, missingForm({ bookingId })),
    ).toEqual({ message: "Only this departure’s crew, owners and managers can start a report." });
    expect(await reportCount(db, tripId)).toBe(before);
  });

  it("opens the owner's prefilled draft, remembering the manifest it came from", async () => {
    const { db, shop, tripId, owner } = await context();
    const bookingId = await markedMissing(db, shop.id, tripId, owner);
    signIn(db, shop, owner);
    const to = await redirectedTo(() =>
      startMissingDiverReportAction(shop.slug, tripId, null, missingForm({ bookingId })),
    );
    expect(to).toMatch(
      new RegExp(
        `/trips/${tripId}/incidents/[0-9a-f-]{36}\\?from=manifest&checkpoint=after_dive_1$`,
      ),
    );
  });

  it("tells a crew member who already started the report, and starts none", async () => {
    const { db, shop, tripId, owner, captain } = await context();
    const bookingId = await markedMissing(db, shop.id, tripId, owner);
    signIn(db, shop, owner);
    await redirectedTo(() =>
      startMissingDiverReportAction(shop.slug, tripId, null, missingForm({ bookingId })),
    );
    // The captain is crew now, and may not read the owner's draft.
    await db.insert(tripAssignments).values({ tripId, personId: captain });
    signIn(db, shop, captain);
    const before = await reportCount(db, tripId);
    const answer = await startMissingDiverReportAction(
      shop.slug,
      tripId,
      null,
      missingForm({ bookingId }),
    );
    expect(answer?.message).toMatch(/^Already started by .+\.$/);
    expect(await reportCount(db, tripId)).toBe(before);
  });

  it("tells a crew member who filed the report, and starts none", async () => {
    // Domain re-review 2026-10-16, item 1: a filed report is still the one
    // report for this disappearance.
    const { db, shop, tripId, owner, captain } = await context();
    const bookingId = await markedMissing(db, shop.id, tripId, owner);
    const started = await startMissingDiverReport(db, {
      shopId: shop.id,
      tripId,
      subject: { kind: "diver", bookingId },
      actorPersonId: owner,
    });
    if (!started.ok) throw new Error(`refused: ${started.reason}`);
    const target = { shopId: shop.id, tripId, reportId: started.reportId, actorPersonId: owner };
    await saveIncidentDraft(db, { ...target, fields: { ...complete, kind: "missing_diver" } });
    expect(await fileIncidentReport(db, target)).toEqual({ ok: true });
    await db.insert(tripAssignments).values({ tripId, personId: captain });
    signIn(db, shop, captain);
    const before = await reportCount(db, tripId);
    const answer = await startMissingDiverReportAction(
      shop.slug,
      tripId,
      null,
      missingForm({ bookingId }),
    );
    expect(answer?.message).toMatch(/^Already filed by .+\.$/);
    expect(await reportCount(db, tripId)).toBe(before);
  });

  it("says so when the seat is no longer missing, and when the write fails", async () => {
    const { db, shop, tripId, owner } = await context();
    signIn(db, shop, owner);
    const [seat] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.tripId, tripId))
      .limit(1);
    if (!seat) throw new Error("expected a seat");
    expect(
      await startMissingDiverReportAction(
        shop.slug,
        tripId,
        null,
        missingForm({ bookingId: seat.id }),
      ),
    ).toEqual({ message: "No longer marked not back aboard." });
    // A failure the database throws is a sentence beside the button, never
    // the manifest swapped for an error page.
    vi.mocked(getDb).mockRejectedValueOnce(new Error("connection reset"));
    expect(
      await startMissingDiverReportAction(
        shop.slug,
        tripId,
        null,
        missingForm({ bookingId: seat.id }),
      ),
    ).toEqual({ message: "The report did not open. Tap again." });
  });
});

describe("deleting a draft from its page", () => {
  it("refuses a staffer who may not read the draft, and deletes nothing", async () => {
    const { db, shop, tripId, owner, captain } = await context();
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId,
      actorPersonId: owner,
    });
    if (!started.ok) throw new Error("expected a draft");
    signIn(db, shop, captain);
    await expect(deleteIncidentDraftAction(shop.slug, tripId, started.reportId)).rejects.toThrow(
      "NOT_FOUND",
    );
    const [row] = await db
      .select({ deletedAt: incidentReports.deletedAt })
      .from(incidentReports)
      .where(eq(incidentReports.id, started.reportId));
    expect(row?.deletedAt).toBeNull();

    signIn(db, shop, owner);
    const to = await redirectedTo(() =>
      deleteIncidentDraftAction(shop.slug, tripId, started.reportId),
    );
    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?view=details#incidents`);
  });
});

/** The manifest button's form: whose row, and the checkpoint it was pressed at. */
function missingForm(subject: { bookingId: string } | { personId: string }): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(subject)) form.set(key, value);
  form.set("checkpoint", "after_dive_1");
  return form;
}

/** One seat on the departure, marked not back aboard after dive 1. */
async function markedMissing(db: AppDb, shopId: string, tripId: string, recorder: string) {
  const [seat] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")))
    .limit(1);
  if (!seat) throw new Error("expected a seat");
  await db.insert(rollCallEvents).values({
    shopId,
    tripId,
    bookingId: seat.id,
    recordedByPersonId: recorder,
    status: "not_boarded",
    checkpoint: "after_dive_1",
    occurredAt: nowDate(),
  });
  return seat.id;
}
