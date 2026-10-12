import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { startIncidentReport } from "@/db/incident-reports";
import { bookings, incidentReports, tripAssignments, trips } from "@/db/schema";
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

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { saveIncidentDraftAction, startIncidentReportAction } = await import("./actions");

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
});
