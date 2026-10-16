import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  deleteIncidentDraft,
  fileIncidentReport,
  getIncidentReport,
  listDepartureLogIncidentReports,
  listTripIncidentReports,
  listUnfiledIncidentDrafts,
  saveIncidentDraft,
  startIncidentReport,
} from "./incident-reports";
import { complete, fixture } from "./incident-reports-test-fixtures";
import { activityEvents, incidentReports, tripAssignments, trips } from "./schema";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **An unfiled draft can be retired** (domain review 2026-10-16, captain frame,
 * finding 3). A draft started twice, or about something that turned out to be
 * nothing, used to stand on Today and on the departure log for ever. Its writer,
 * an owner or a manager may now Delete it: softly, said on the departure's
 * trail, and still listed on the log as a deleted draft.
 */
describe("deleting an unfiled draft", () => {
  async function draft() {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await db.delete(incidentReports).where(eq(incidentReports.shopId, shop.id));
    const input = { shopId: shop.id, tripId: f.trip.id, actorPersonId: f.crew.id };
    const started = await startIncidentReport(db, input);
    if (!started.ok) throw new Error("expected a draft");
    return { ...f, db, shop, input, reportId: started.reportId };
  }

  it("lets its writer delete it, says so on the trail, and keeps the row", async () => {
    const { db, shop, input, reportId, crew, owner, trip } = await draft();
    expect(await deleteIncidentDraft(db, { ...input, reportId })).toEqual({ ok: true });

    const [row] = await db
      .select({ deletedAt: incidentReports.deletedAt, by: incidentReports.deletedByPersonId })
      .from(incidentReports)
      .where(eq(incidentReports.id, reportId));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.by).toBe(crew.id);
    const [line] = await db
      .select({ params: activityEvents.params })
      .from(activityEvents)
      .where(
        and(eq(activityEvents.tripId, trip.id), eq(activityEvents.code, "incident_draft_deleted")),
      );
    // Who deleted it, and nothing about what it said.
    expect(line?.params).toEqual({ actor: crew.fullName });

    // Gone from every working list, and from the report's own door.
    expect(await getIncidentReport(db, shop.id, reportId, owner.id)).toBeNull();
    expect((await listTripIncidentReports(db, shop.id, trip.id, owner.id)).reports).toEqual([]);
    expect(await listUnfiledIncidentDrafts(db, shop.id, owner.id)).toEqual([]);
    // Still on the log, as a deleted draft and by whom.
    const logged = await listDepartureLogIncidentReports(db, shop.id, trip.id, owner.id);
    expect(logged).toMatchObject([{ reportId, status: "draft", deletedByName: crew.fullName }]);
    expect(logged?.[0]?.deletedAt).toBeInstanceOf(Date);
  });

  it("lets an owner delete a crew member's draft, and nobody else's draft be deleted by crew", async () => {
    const { db, input, reportId, owner, ashore, trip } = await draft();
    // Another crew member may not read this draft, so may not delete it.
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: ashore.id });
    expect(await deleteIncidentDraft(db, { ...input, reportId, actorPersonId: ashore.id })).toEqual(
      { ok: false, reason: "not_found" },
    );
    expect(await deleteIncidentDraft(db, { ...input, reportId, actorPersonId: owner.id })).toEqual({
      ok: true,
    });
    // Twice is the same as a report that is not there.
    expect(await deleteIncidentDraft(db, { ...input, reportId, actorPersonId: owner.id })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a filed report: it changes only by addendum", async () => {
    const { db, input, reportId } = await draft();
    await saveIncidentDraft(db, { ...input, reportId, fields: complete });
    await fileIncidentReport(db, { ...input, reportId });
    expect(await deleteIncidentDraft(db, { ...input, reportId })).toEqual({
      ok: false,
      reason: "filed",
    });
  });

  it("is never reopened by the next start", async () => {
    const { db, input, reportId } = await draft();
    await deleteIncidentDraft(db, { ...input, reportId });
    const next = await startIncidentReport(db, input);
    expect(next).toMatchObject({ ok: true, reused: false });
    if (!next.ok) throw new Error("expected a draft");
    expect(next.reportId).not.toBe(reportId);
  });

  it("refuses every write to a deleted draft as if it did not exist", async () => {
    const { db, input, reportId } = await draft();
    await deleteIncidentDraft(db, { ...input, reportId });
    expect(await saveIncidentDraft(db, { ...input, reportId, fields: complete })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

/** Domain review 2026-10-16, captain frame, finding 4. */
describe("a rehearsal's drafts", () => {
  it("never raise Today's line about unfiled reports", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await db.delete(incidentReports).where(eq(incidentReports.shopId, shop.id));
    await db
      .update(trips)
      .set({ isRehearsal: true, isPrivate: true })
      .where(eq(trips.id, f.trip.id));
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    expect(started).toMatchObject({ ok: true });
    expect(await listUnfiledIncidentDrafts(db, shop.id, f.owner.id)).toEqual([]);
  });
});
