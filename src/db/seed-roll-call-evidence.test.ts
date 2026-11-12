import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { canonicalRollCallEvidenceId } from "@/lib/roll-call-causality";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest } from "./manifests";
import { seedRollCallEvidence } from "./seed-roll-call-evidence";

async function fixture() {
  const { db, shop, reef, booking, staff } = await manifestContext();
  return {
    db,
    shop,
    reef,
    booking,
    base: {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1",
      meetingDay: 0,
      occurredAt: nowDate(),
    },
  };
}

describe("fixture evidence authorship", () => {
  it("defaults to unknown basis and keeps opposing evidence despite reversed capture clocks", async () => {
    const { db, base, shop, reef, booking } = await fixture();
    const rows = await seedRollCallEvidence(db, [
      { ...base, status: "boarded", occurredAt: new Date("2026-07-20T14:10Z") },
      { ...base, status: "not_boarded", occurredAt: new Date("2026-07-20T14:00Z") },
    ]);
    expect(rows.map((row) => row.observedEvidenceIds)).toEqual([null, null]);
    expect(rows[1]).toMatchObject({
      status: "not_boarded",
      statementStatus: "not_boarded",
      evidenceConflict: true,
    });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
        (row) => row.bookingId === booking.booking.id,
      )?.rollCallContext,
    ).toMatchObject({ conflict: true });
  });

  it("merges compatible unknown statements without inventing observation", async () => {
    const { db, base } = await fixture();
    const rows = await seedRollCallEvidence(db, [
      { ...base, status: "boarded" },
      { ...base, status: "boarded" },
    ]);
    expect(rows.map((row) => row.observedEvidenceIds)).toEqual([null, null]);
    expect(rows[1]).toMatchObject({ status: "boarded", evidenceConflict: false });
    expect(rows[1].causalFrontier).toHaveLength(2);
  });

  it("chains a deliberately authored sequential correction and exact undo", async () => {
    const { db, base } = await fixture();
    const rows = await seedRollCallEvidence(
      db,
      [
        { ...base, status: "not_boarded", occurredAt: new Date("2026-07-20T14:10Z") },
        { ...base, status: "boarded", occurredAt: new Date("2026-07-20T14:00Z") },
        { ...base, status: "cleared", occurredAt: new Date("2026-07-20T13:55Z") },
      ],
      { observesPrevious: true },
    );
    expect(rows[1].observedEvidenceIds).toEqual([canonicalRollCallEvidenceId(rows[0])]);
    expect(rows[1]).toMatchObject({ status: "boarded", evidenceConflict: false });
    expect(rows[2]).toMatchObject({
      status: "cleared",
      retractsEventId: rows[1].id,
      evidenceConflict: false,
    });
  });

  it("does not turn declared observation of opposing marks into implicit reconciliation", async () => {
    const { db, base } = await fixture();
    await seedRollCallEvidence(db, [
      { ...base, status: "not_boarded" },
      { ...base, status: "boarded" },
    ]);
    const [ordinary] = await seedRollCallEvidence(
      db,
      { ...base, status: "boarded" },
      { observesPrevious: true },
    );
    expect(ordinary).toMatchObject({
      status: "not_boarded",
      evidenceConflict: true,
      reconcilesEvidence: false,
    });
  });
});
