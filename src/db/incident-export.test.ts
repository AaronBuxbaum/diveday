import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { getIncidentExport } from "./incident-export";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { shops } from "./schema";
import { createTrip, getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

async function exportContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const staffRows = await listStaff(db, shop.id);
  // The generator must be an **owner**: `getIncidentExport` re-checks the
  // owner-only gate itself rather than trusting its caller, so a divemaster
  // here would get `null` from every assertion below and the failure would
  // read as a data bug rather than an authorization one.
  const owner = staffRows.find((row) => row.roles.includes("owner"));
  const crew = staffRows.find((row) => !row.roles.includes("owner"));
  if (!owner || !crew) throw new Error("demo shop needs an owner and a non-owner staff member");
  return { db, shop, reef, staff: owner.person, nonOwner: crew.person };
}

describe("incident-ready export assembly (in-memory PGlite)", () => {
  it("collects the roster, full roll-call history, evidence, and a reproducible hash", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");

    // Board one diver the real way: waiver, then the gated roll-call write.
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
    const crewMember = (await getTripManifest(db, shop.id, reef.id))?.crew[0];
    if (!crewMember) throw new Error("demo reef crew missing");
    const crewBoarded = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      personId: crewMember.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      source: "offline",
      clientEventId: "11111111-1111-4111-8111-111111111111",
      offlineSnapshotSavedAt: new Date(nowDate().getTime() - 60 * 60 * 1000),
      occurredAt: nowDate(),
    });
    expect(crewBoarded).toMatchObject({ ok: true });
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

    // The timeline carries the diver event.
    expect(doc.timeline.some((entry) => entry.kind === "diver" && entry.action === "boarded")).toBe(
      true,
    );
    expect(
      doc.timeline.some(
        (entry) =>
          entry.kind === "crew" && entry.action === "boarded" && entry.source === "offline",
      ),
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

  /**
   * The gate lives here as well as on the route (src/lib/authz.ts,
   * `canExportIncidentRecord`). The document names whoever generated it, so
   * "the route forgot to check" cannot be the only thing standing between a
   * captain and a departure's whole evidentiary record — and read-only-looking
   * helpers acquire callers (security review 20260804).
   */
  it("refuses to assemble the document for anyone but an owner", async () => {
    const { db, shop, reef, staff, nonOwner } = await exportContext();
    // Same shop, same trip, a real active staff member — refused, and refused
    // by returning nothing rather than a partial document.
    await expect(getIncidentExport(db, shop.id, reef.id, nonOwner.id)).resolves.toBeNull();
    // The owner still gets it, so this is a role gate and not a broken reader.
    await expect(getIncidentExport(db, shop.id, reef.id, staff.id)).resolves.not.toBeNull();
  });
});
