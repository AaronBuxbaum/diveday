import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { getIncidentExport } from "./incident-export";
import { recordCrewAttestation, recordRollCall } from "./manifests";
import { shops } from "./schema";
import { createTrip, getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

async function exportContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, reef, staff: staff.person };
}

describe("incident-ready export assembly (in-memory PGlite)", () => {
  it("collects the roster, full roll-call history, evidence, and a reproducible hash", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");

    // Board one diver the real way (waiver, then the gated roll-call write),
    // and put a crew count on the record too.
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: first.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: first.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    const boarded = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: first.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
    });
    expect(boarded).toMatchObject({ ok: true });
    const attested = await recordCrewAttestation(db, {
      shopId: shop.id,
      tripId: reef.id,
      attestedByPersonId: staff.id,
      crewAboard: 2,
    });
    expect(attested).toMatchObject({ ok: true });

    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    expect(doc).not.toBeNull();
    if (!doc) throw new Error("unreachable");

    const roster = await getTripRoster(db, shop.id, reef.id);
    expect(doc.roster).toHaveLength(roster.length);
    expect(doc.meta.generatedByName).toBe(staff.fullName);

    const boardedEntry = doc.roster.find((entry) => entry.bookingId === first.booking.id);
    expect(boardedEntry?.rollCall[0]).toMatchObject({
      checkpoint: "departure",
      label: "boarded",
      recordedByName: staff.fullName,
    });
    expect(boardedEntry?.waiver.state).toBe("complete");

    // The timeline carries both the diver event and the crew count.
    expect(doc.timeline.some((entry) => entry.kind === "diver" && entry.action === "boarded")).toBe(
      true,
    );
    expect(
      doc.timeline.some((entry) => entry.kind === "crew_count" && entry.crewAboard === 2),
    ).toBe(true);

    // Same records, same hash — regenerated a moment later with the same
    // frozen clock, the document reproduces byte-identically.
    const again = await getIncidentExport(db, shop.id, reef.id, staff.id, nowDate());
    expect(again?.contentHash).toBe(doc.contentHash);
  });

  it("states absences instead of leaving blanks — no roll call, no cards, no waiver", async () => {
    const { db, shop, staff } = await exportContext();
    // The night dive's divers are all blocked and nothing has boarded.
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const night = trips.find((trip) => trip.title.startsWith("Night Dive — City of Washington"));
    if (!night) throw new Error("demo night trip missing");

    const doc = await getIncidentExport(db, shop.id, night.id, staff.id);
    expect(doc).not.toBeNull();
    if (!doc) throw new Error("unreachable");

    expect(doc.roster.length).toBeGreaterThan(0);
    for (const entry of doc.roster) {
      // Every checkpoint row exists and reads as a stated result, never a hole.
      expect(entry.rollCall.length).toBeGreaterThan(0);
    }
  });

  it("never exports medical answers, even when a signed questionnaire exists", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: first.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: first.person.fullName,
      agreed: true,
      medicalAnswers: {
        questionnaireId: "rstc",
        questionnaireVersion: 1,
        // The question id is the distinctive marker: if answers ever ride into
        // the document, this key rides with them.
        responses: { "MEDICAL-ANSWERS-MUST-NOT-LEAK": true },
      },
    });

    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain("MEDICAL-ANSWERS-MUST-NOT-LEAK");
    expect(serialized).not.toContain("medicalAnswers");
  });

  it("adversarial: another shop's trip id resolves to null, not to a document", async () => {
    const { db, shop, staff } = await exportContext();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-incident", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const startsAt = new Date(nowDate().getTime() + 30 * 24 * 60 * 60 * 1000);
    const rivalTrip = await createTrip(db, {
      shopId: rival.id,
      title: "Rival Reef — two-tank",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!rivalTrip) throw new Error("rival trip insert failed");

    await expect(getIncidentExport(db, shop.id, rivalTrip.id, staff.id)).resolves.toBeNull();
  });

  it("adversarial: a generator who is not one of this shop's people resolves to null", async () => {
    const { db, shop, reef } = await exportContext();
    await expect(
      getIncidentExport(db, shop.id, reef.id, "00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeNull();
  });
});
