import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "../features/anonymize/store";
import { complete, fixture } from "../test/substrate-fixtures/db/incident-reports-test-fixtures";
import {
  fileIncidentReport,
  getIncidentReport,
  recordIncidentDraft,
  setIncidentLegalHold,
  startIncidentReport,
} from "./incident-reports";
import { incidentReports } from "./schema";

const ctx = fileScopedShopContext();

describe("erasing a diver named in a report under a legal hold", () => {
  /**
   * The erasure waits for the hold (issue #3805, Aaron's option A); once the
   * hold is released it unlinks the diver and the report itself stays (#2391).
   */
  it("waits for the hold, then unlinks the diver and still keeps the report", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const name = f.seat.person.fullName;
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    const base = {
      shopId: shop.id,
      reportId: started.reportId,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    };
    await recordIncidentDraft(db, {
      ...base,
      fields: { ...complete, whatHappened: `${name} surfaced coughing.` },
    });
    await fileIncidentReport(db, base);
    expect(
      await setIncidentLegalHold(db, { ...base, actorPersonId: f.owner.id, held: true }),
    ).toEqual({ ok: true });

    const erase = () =>
      anonymizeDiver(db, {
        shopId: shop.id,
        personId: f.seat.person.id,
        actorPersonId: f.owner.id,
      });
    expect(await erase()).toEqual({ ok: false, reason: "incident_hold" });
    expect(
      await setIncidentLegalHold(db, { ...base, actorPersonId: f.owner.id, held: false }),
    ).toEqual({ ok: true });
    expect(await erase()).toMatchObject({ ok: true });

    const view = await getIncidentReport(db, shop.id, started.reportId, f.owner.id);
    expect(view?.status).toBe("filed");
    expect(view?.fields.whatHappened).toBe(`${name} surfaced coughing.`);
    const [row] = await db
      .select({ heldAt: incidentReports.legalHoldAt, deletedAt: incidentReports.deletedAt })
      .from(incidentReports)
      .where(eq(incidentReports.id, started.reportId));
    expect(row?.heldAt).toBeNull();
    expect(row?.deletedAt).toBeNull();
  });
});
