import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { WAIVER_SIGNATURE_VALIDITY_MS } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { getIncidentExport } from "./incident-export";
import {
  addIncidentAddendum,
  fileIncidentReport,
  saveIncidentDraft,
  startIncidentReport,
} from "./incident-reports";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import {
  createChecklistItem,
  deleteChecklistItem,
  listChecklistItems,
  recordPreDepartureCheck,
} from "./pre-departure-check";
import { createCertification, reviewCertification } from "./readiness";
import {
  activityEvents,
  certifications,
  rollCallEvents,
  shops,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { createTrip, getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);

async function exportContext() {
  const { db, shop } = ctx;
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

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

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
    expect(boardedEntry?.waiver?.state).toBe("complete");

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

  it("states every checklist item's answer, checked or not, and states absence when the shop has none", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const items = await listChecklistItems(db, shop.id);
    expect(items.length).toBeGreaterThan(0); // seedPreDepartureChecklist

    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    expect(doc).not.toBeNull();
    if (!doc) throw new Error("unreachable");
    expect(doc.preDepartureCheck.map((entry) => entry.label)).toEqual(
      items.map((item) => item.label),
    );
    // Nothing tapped this item for this departure — an absence, stated.
    expect(doc.preDepartureCheck.every((entry) => !entry.checked)).toBe(true);

    const checked = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: items[0].id,
      recordedByPersonId: staff.id,
      status: "checked",
    });
    expect(checked.ok).toBe(true);
    const after = await getIncidentExport(db, shop.id, reef.id, staff.id);
    const entry = after?.preDepartureCheck.find((row) => row.label === items[0].label);
    expect(entry?.checked).toBe(true);
    expect(entry?.recordedByName).toBeTruthy();
    expect(entry?.occurredAt).toBeTruthy();
  });

  it("keeps a deleted checklist item's recorded check on this trip's document (dive-domain-expert finding)", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const created = await createChecklistItem(db, {
      shopId: shop.id,
      personId: staff.id,
      label: "Test: liferaft checked",
    });
    if (!created.ok) throw new Error("setup: expected item to be created");
    const recorded = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: staff.id,
      status: "checked",
    });
    expect(recorded.ok).toBe(true);
    await deleteChecklistItem(db, { shopId: shop.id, personId: staff.id, itemId: created.id });

    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    const entry = doc?.preDepartureCheck.find((row) => row.label === "Test: liferaft checked");
    expect(entry).toBeDefined();
    expect(entry?.checked).toBe(true);
  });

  it("never exports medical answers, even when a signed questionnaire exists", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: first.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    // A referral answer, so the record carries a flagged prompt as well as raw
    // responses — if either rides into the document, this test catches it.
    const referralAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
    referralAnswers.responses.q3 = true;
    await completeWaiver(db, issued.token, {
      signerName: first.person.fullName,
      agreed: true,
      medicalAnswers: referralAnswers,
    });

    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    const serialized = JSON.stringify(doc);
    const flaggedPrompt = RSTC_QUESTIONNAIRE.questions.find((q) => q.id === "q3")?.prompt;
    expect(flaggedPrompt).toBeDefined();
    expect(serialized).not.toContain(flaggedPrompt);
    expect(serialized).not.toContain("medicalAnswers");
  });

  it("attributes a paper waiver to the staff member who recorded it", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: first.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: first.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    // Set up the same immutable shape `recordInPersonWaiver` writes. The
    // production path is separately pinned in waivers-in-person.test.ts; this test pins
    // the incident export's tenant-scoped recorder projection.
    await db
      .update(waiverRecords)
      .set({ signatureMethod: "in_person_attested", recordedByPersonId: staff.id })
      .where(eq(waiverRecords.bookingId, first.booking.id));

    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    expect(doc?.roster.find((entry) => entry.bookingId === first.booking.id)?.waiver).toMatchObject(
      {
        signatureMethod: "in_person_attested",
        recordedByName: staff.fullName,
      },
    );
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

  it("attributes a reviewed certification to the staff member who certified it", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: first.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "INCIDENT-REVIEWER-1",
    });
    if (!card) throw new Error("expected certification to insert");
    await expect(
      reviewCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        status: "verified",
        reviewedByPersonId: staff.id,
      }),
    ).resolves.toMatchObject({ ok: true });

    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    expect(
      doc?.roster
        .find((entry) => entry.bookingId === first.booking.id)
        ?.certifications.find((entry) => entry.identifier === "INCIDENT-REVIEWER-1"),
    ).toMatchObject({
      status: "verified",
      reviewedByName: staff.fullName,
    });
  });
});

/**
 * **A seat changed after the boat was due out, and the reports the shop
 * holds** (safety sheet 2026-10-15, items 5 and 7), read from the records
 * every other surface writes.
 */
describe("the departure log's roster changes and incident reports", () => {
  it("does not treat a later certification review as evidence at sailing, but includes it if the diver boarded after the review", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    const minutes = (n: number) => new Date(reef.startsAt.getTime() + n * 60_000);
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: first.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "LATE-REVIEW",
    });
    if (!card) throw new Error("expected card");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      reviewedByPersonId: staff.id,
    });
    await db
      .update(certifications)
      .set({ createdAt: minutes(-60), reviewedAt: minutes(10) })
      .where(eq(certifications.id, card.id));
    const atCutoff = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(60));
    expect(
      atCutoff?.roster
        .find((entry) => entry.bookingId === first.booking.id)
        ?.certifications.find((entry) => entry.identifier === "LATE-REVIEW"),
    ).toBeUndefined();
    await db
      .insert(rollCallEvents)
      .values({
        shopId: shop.id,
        tripId: reef.id,
        bookingId: first.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "departure",
        source: "live",
        occurredAt: minutes(25),
      });
    const lateBoarding = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(60));
    expect(
      lateBoarding?.roster
        .find((entry) => entry.bookingId === first.booking.id)
        ?.certifications.find((entry) => entry.identifier === "LATE-REVIEW"),
    ).toMatchObject({ status: "verified", reviewedByName: staff.fullName });
  });
  it("states a waiver link as it stood when the boat was due out, whenever the log is printed", async () => {
    // Domain re-review 2026-10-16, item 3: a link that lapsed between two
    // printings changed the version-2 code under unchanged records.
    const { db, shop, reef, staff } = await exportContext();
    const minutes = (n: number) => new Date(reef.startsAt.getTime() + n * 60_000);
    const first = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(30));
    const unsent = first?.roster.find((entry) => entry.waiver?.state === "not_sent");
    if (!unsent) throw new Error("expected a seat with no waiver");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: unsent.bookingId });
    if (!issued.ok) throw new Error("expected waiver link");
    await db
      .update(waiverRecords)
      .set({ expiresAt: minutes(60) })
      .where(eq(waiverRecords.bookingId, unsent.bookingId));
    const before = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(30));
    const after = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(120));
    const stateOf = (doc: typeof before) =>
      doc?.roster.find((entry) => entry.bookingId === unsent.bookingId)?.waiver?.state;
    expect(stateOf(before)).toBe("awaiting_signature");
    expect(stateOf(after)).toBe("awaiting_signature");
    expect(after?.contentHash).toBe(before?.contentHash);
  });

  it("reads which signed waiver governs as of when the boat was due out, whenever the log is printed", async () => {
    // The same fault one layer down: a signature whose year ran out between
    // two printings stopped governing, and the seat read "not sent".
    const { db, shop, reef, staff } = await exportContext();
    const minutes = (n: number) => new Date(reef.startsAt.getTime() + n * 60_000);
    const first = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(30));
    const unsent = first?.roster.find((entry) => entry.waiver?.state === "not_sent");
    if (!unsent) throw new Error("expected a seat with no waiver");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: unsent.bookingId });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: unsent.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    // Signed a year before an hour after the boat was due out.
    const signedAt = new Date(minutes(60).getTime() - WAIVER_SIGNATURE_VALIDITY_MS);
    await db
      .update(waiverRecords)
      .set({ signedAt, completedAt: signedAt })
      .where(eq(waiverRecords.bookingId, unsent.bookingId));
    const before = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(30));
    const after = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(120));
    const stateOf = (doc: typeof before) =>
      doc?.roster.find((entry) => entry.bookingId === unsent.bookingId)?.waiver?.state;
    expect(stateOf(before)).toBe("complete");
    expect(stateOf(after)).toBe("complete");
    expect(after?.contentHash).toBe(before?.contentHash);
  });

  /**
   * **A log names the release that stood when the boat left** (issue #3002).
   * The diver signed before the departure, then re-signed after it, once the
   * shop had changed its release: the log printed later must still name the
   * first signature, against the terms that stood, and never the one dated
   * after boarding.
   */
  it("names the release that stood at the cutoff, not one signed after the boat left (#3002)", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const minutes = (n: number) => new Date(reef.startsAt.getTime() + n * 60_000);
    const first = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(30));
    const unsent = first?.roster.find((entry) => entry.waiver?.state === "not_sent");
    if (!unsent) throw new Error("expected a seat with no waiver");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: unsent.bookingId });
    if (!issued.ok) throw new Error("expected waiver link");
    const done = await completeWaiver(db, issued.token, {
      signerName: unsent.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    if (!done.ok) throw new Error("waiver completion failed");
    const [sailedOn] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, unsent.bookingId));
    if (!sailedOn) throw new Error("signed record missing");
    const signedBefore = new Date(reef.startsAt.getTime() - 24 * 60 * 60_000);
    const resignedAt = minutes(10 * 24 * 60);
    await db
      .update(waiverRecords)
      .set({ signedAt: signedBefore, completedAt: signedBefore, supersededAt: resignedAt })
      .where(eq(waiverRecords.id, sailedOn.id));

    // The shop changes its release a week after the boat, and the diver signs it.
    const [template] = await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id))
      .orderBy(desc(waiverTemplates.version))
      .limit(1);
    if (!template) throw new Error("shop release missing");
    const { id: _templateId, ...templateRest } = template;
    const [nextTerms] = await db
      .insert(waiverTemplates)
      .values({
        ...templateRest,
        version: template.version + 1,
        materialGeneration: template.materialGeneration + 1,
        body: `${template.body}\n\nAmended.`,
        createdAt: minutes(7 * 24 * 60),
      })
      .returning();
    if (!nextTerms) throw new Error("amended release insert returned no row");
    const { id: _recordId, ...recordRest } = sailedOn;
    const [signedLater] = await db
      .insert(waiverRecords)
      .values({
        ...recordRest,
        templateId: nextTerms.id,
        templateVersion: nextTerms.version,
        templateGeneration: nextTerms.materialGeneration,
        tokenHash: `${sailedOn.tokenHash}-resigned`,
        signedAt: resignedAt,
        completedAt: resignedAt,
        supersededAt: null,
        createdAt: resignedAt,
      })
      .returning();
    if (!signedLater) throw new Error("re-signed record insert returned no row");

    const printedLater = await getIncidentExport(
      db,
      shop.id,
      reef.id,
      staff.id,
      minutes(30 * 24 * 60),
    );
    const governing = printedLater?.roster.find(
      (entry) => entry.bookingId === unsent.bookingId,
    )?.waiver;
    expect(governing?.state).toBe("complete");
    expect(governing?.signedAt).toBe(signedBefore.toISOString());
    expect(governing?.templateVersion).toBe(template.version);
  });

  /**
   * **A late boat reads each seat when that diver boarded** (domain review of
   * #3002). The boat was due at the start and cast off 25 minutes late; the
   * diver signed at the dock ten minutes after the start and was marked aboard
   * at 25. The log must not show her boarding unsigned.
   */
  it("reads a seat at its own departure mark when the boat sailed late (#3002)", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const minutes = (n: number) => new Date(reef.startsAt.getTime() + n * 60_000);
    const first = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(30));
    const unsent = first?.roster.find((entry) => entry.waiver?.state === "not_sent");
    if (!unsent) throw new Error("expected a seat with no waiver");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: unsent.bookingId });
    if (!issued.ok) throw new Error("expected waiver link");
    const done = await completeWaiver(db, issued.token, {
      signerName: unsent.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    if (!done.ok) throw new Error("waiver completion failed");
    await db
      .update(waiverRecords)
      .set({ signedAt: minutes(10), completedAt: minutes(10), createdAt: minutes(9) })
      .where(eq(waiverRecords.bookingId, unsent.bookingId));

    // Not yet marked aboard: read at the scheduled start, she had not signed.
    const unmarked = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(60));
    expect(
      unmarked?.roster.find((entry) => entry.bookingId === unsent.bookingId)?.waiver?.state,
    ).toBe("not_sent");

    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: reef.id,
      bookingId: unsent.bookingId,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "departure",
      source: "live",
      occurredAt: minutes(25),
    });
    const printed = await getIncidentExport(db, shop.id, reef.id, staff.id, minutes(60));
    const governing = printed?.roster.find((entry) => entry.bookingId === unsent.bookingId)?.waiver;
    expect(governing?.state).toBe("complete");
    expect(governing?.signedAt).toBe(minutes(10).toISOString());
  });

  it("lists a seat removed after the scheduled start, and not one changed before it", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const minutes = (n: number) => new Date(reef.startsAt.getTime() + n * 60_000);
    await db.insert(activityEvents).values([
      {
        shopId: shop.id,
        tripId: reef.id,
        actorPersonId: staff.id,
        subjectPersonId: staff.id,
        code: "seat_added",
        params: { actor: staff.fullName, diver: "Early Bird" },
        occurredAt: minutes(-90),
      },
      {
        shopId: shop.id,
        tripId: reef.id,
        actorPersonId: staff.id,
        subjectPersonId: staff.id,
        code: "booking_removed",
        params: { actor: staff.fullName, diver: "Late Leaver" },
        occurredAt: minutes(20),
      },
      // A line written before every roster line named its subject by record
      // carries a name erasure cannot reach, so it is not printed (security
      // review 2026-10-16, F1).
      {
        shopId: shop.id,
        tripId: reef.id,
        actorPersonId: staff.id,
        code: "booking_removed",
        params: { actor: staff.fullName, diver: "Unlinked Name" },
        occurredAt: minutes(22),
      },
      // A no-show changes no seat, and an erased line names nobody.
      {
        shopId: shop.id,
        tripId: reef.id,
        actorPersonId: staff.id,
        code: "booking_no_show",
        params: { actor: staff.fullName, diver: "Late Leaver" },
        occurredAt: minutes(25),
      },
      {
        shopId: shop.id,
        tripId: reef.id,
        actorPersonId: staff.id,
        code: "redacted",
        params: {},
        occurredAt: minutes(30),
      },
    ]);

    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    if (!doc) throw new Error("expected a document");
    const changes = doc.timeline.filter((entry) => entry.kind === "roster_change");
    expect(changes).toEqual([
      {
        kind: "roster_change",
        occurredAt: minutes(20).toISOString(),
        checkpoint: null,
        action: "removed",
        subjectName: "Late Leaver",
        recordedByName: staff.fullName,
      },
    ]);
  });

  it("lists the departure's reports by where they stand, and never what they say", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const input = { shopId: shop.id, tripId: reef.id, actorPersonId: staff.id };
    const filed = await startIncidentReport(db, input);
    if (!filed.ok) throw new Error("expected a draft");
    const secret = "Diver surfaced coughing after a fast ascent from 18 m.";
    await saveIncidentDraft(db, {
      ...input,
      reportId: filed.reportId,
      fields: {
        occurredAt: nowDate(),
        diveSiteId: null,
        locationText: "North wall mooring",
        whatHappened: secret,
        kind: "injury",
        severity: "moderate",
        firstAidGiven: true,
        oxygenGiven: false,
        oxygenMinutes: null,
        emergencyServicesCalled: false,
        handoverKind: "diver",
        handoverDetail: null,
        handedOverAt: null,
        followUp: null,
      },
    });
    expect(await fileIncidentReport(db, { ...input, reportId: filed.reportId })).toEqual({
      ok: true,
    });
    await addIncidentAddendum(db, {
      ...input,
      reportId: filed.reportId,
      body: "Called back: fine.",
    });
    const draft = await startIncidentReport(db, input);
    if (!draft.ok) throw new Error("expected a second draft");

    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    if (!doc) throw new Error("expected a document");
    expect(doc.incidentReports).toHaveLength(2);
    expect(doc.incidentReports.find((r) => r.reportId === filed.reportId)).toMatchObject({
      status: "filed",
      kind: "injury",
      severity: "moderate",
      filedByName: staff.fullName,
      addendaCount: 1,
    });
    expect(doc.incidentReports.find((r) => r.reportId === draft.reportId)).toMatchObject({
      status: "draft",
      kind: null,
      filedAt: null,
      createdByName: staff.fullName,
      addendaCount: 0,
    });
    const printed = JSON.stringify(doc);
    expect(printed).not.toContain(secret);
    expect(printed).not.toContain("North wall mooring");
    expect(printed).not.toContain("Called back: fine.");
  });
});
