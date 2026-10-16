import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  discardIncidentDraft,
  getIncidentReport,
  listDepartureLogIncidentReports,
  listTripIncidentReports,
  listUnfiledIncidentDrafts,
  saveIncidentDraft,
  startIncidentReport,
} from "./incident-reports";
import { complete, fixture } from "./incident-reports-test-fixtures";
import { activityEvents, incidentReports, trips } from "./schema";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **A discarded draft stays on the departure log** (domain review 2026-10-16,
 * captain frame, finding 3). An owner discards a mistaken draft
 * (`discardIncidentDraft`, ADR 20261015-incident-draft-discard-and-hold); it
 * leaves every working list and Today's line, and the log still lists it as a
 * deleted draft, and by whom.
 */
describe("discarding an unfiled draft", () => {
  async function draft() {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await db.delete(incidentReports).where(eq(incidentReports.shopId, shop.id));
    const input = { shopId: shop.id, tripId: f.trip.id, actorPersonId: f.crew.id };
    const started = await startIncidentReport(db, input);
    if (!started.ok) throw new Error("expected a draft");
    return { ...f, db, shop, input, reportId: started.reportId };
  }

  it("records who discarded it, and the log still lists it by them", async () => {
    const { db, shop, input, reportId, owner, trip } = await draft();
    // Owner only: not even the draft's own writer (issue #2530).
    expect(await discardIncidentDraft(db, { ...input, reportId })).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect(await discardIncidentDraft(db, { ...input, reportId, actorPersonId: owner.id })).toEqual(
      { ok: true },
    );

    const [row] = await db
      .select({ deletedAt: incidentReports.deletedAt, by: incidentReports.deletedByPersonId })
      .from(incidentReports)
      .where(eq(incidentReports.id, reportId));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.by).toBe(owner.id);
    const [line] = await db
      .select({ params: activityEvents.params })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.tripId, trip.id),
          eq(activityEvents.code, "incident_draft_discarded"),
        ),
      );
    // Who discarded it, and nothing about what it said.
    expect(line?.params).toEqual({ actor: owner.fullName });

    // Gone from every working list, and from the report's own door.
    expect(await getIncidentReport(db, shop.id, reportId, owner.id)).toBeNull();
    expect((await listTripIncidentReports(db, shop.id, trip.id, owner.id)).reports).toEqual([]);
    expect(await listUnfiledIncidentDrafts(db, shop.id, owner.id)).toEqual([]);
    // Still on the log, as a deleted draft and by whom.
    const logged = await listDepartureLogIncidentReports(db, shop.id, trip.id, owner.id);
    expect(logged).toMatchObject([{ reportId, status: "draft", deletedByName: owner.fullName }]);
    expect(logged?.[0]?.deletedAt).toBeInstanceOf(Date);
  });

  it("is never reopened by the next start", async () => {
    const { db, input, reportId, owner } = await draft();
    await discardIncidentDraft(db, { ...input, reportId, actorPersonId: owner.id });
    const next = await startIncidentReport(db, input);
    expect(next).toMatchObject({ ok: true, reused: false });
    if (!next.ok) throw new Error("expected a draft");
    expect(next.reportId).not.toBe(reportId);
  });

  it("refuses every write to a discarded draft as if it did not exist", async () => {
    const { db, input, reportId, owner } = await draft();
    await discardIncidentDraft(db, { ...input, reportId, actorPersonId: owner.id });
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
