import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { cancelBooking } from "./bookings";
import { mergeDiverRecords } from "./diver-merge";
import { getIncidentExport } from "./incident-export";
import { recordRollCall } from "./manifests";
import { createCertification, reviewCertification } from "./readiness";
import { bookings, certifications, people, personRoles, rollCallEvents } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
const ctx = fileScopedShopContext();
async function exportContext() {
  const { db, shop } = ctx;
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((trip) =>
    trip.title.startsWith("Two-Tank Reef — Molasses"),
  );
  const owner = (await listStaff(db, shop.id)).find((row) => row.roles.includes("owner"));
  if (!reef || !owner) throw new Error("demo reef trip or owner missing");
  return { db, shop, reef, staff: owner.person };
}

describe("departure-log certification captures", () => {
  it("labels current cards separately when historic evidence cannot be reconstructed", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
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
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: reef.id,
      bookingId: first.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "departure",
      source: "offline",
      occurredAt: nowDate(),
      clientEventId: "11111111-1111-4111-8111-111111111111",
    });
    const doc = await getIncidentExport(db, shop.id, reef.id, staff.id);
    const entry = doc?.roster.find((row) => row.bookingId === first.booking.id);
    expect(entry?.certificationsAtCapture).toBeNull();
    expect(entry?.certifications.find((row) => row.identifier === "LATE-REVIEW")).toMatchObject({
      status: "verified",
      reviewedByName: staff.fullName,
    });
  });
  it("keeps the live boarding's card evidence when a later review changes", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: first.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "BOARD-CARD",
    });
    if (!card) throw new Error("expected card");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      reviewedByPersonId: staff.id,
    });
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: first.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: first.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: first.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });
    const before = await getIncidentExport(db, shop.id, reef.id, staff.id);
    await db
      .update(certifications)
      .set({ status: "pending", reviewedAt: null, reviewedByPersonId: null })
      .where(eq(certifications.id, card.id));
    const after = await getIncidentExport(db, shop.id, reef.id, staff.id);
    const entry = after?.roster.find((row) => row.bookingId === first.booking.id);
    expect(
      entry?.certificationsAtCapture?.find((row) => row.identifier === "BOARD-CARD"),
    ).toMatchObject({ status: "verified", reviewedByName: staff.fullName });
    expect(entry?.certifications.find((row) => row.identifier === "BOARD-CARD")).toMatchObject({
      status: "pending",
    });
    expect(after?.contentHash).toBe(before?.contentHash);
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: first.booking.id,
        recordedByPersonId: staff.id,
        status: "cleared",
      }),
    ).toMatchObject({ ok: true });
    const undone = await getIncidentExport(db, shop.id, reef.id, staff.id);
    expect(
      undone?.roster.find((row) => row.bookingId === first.booking.id)?.certificationsAtCapture,
    ).toBeNull();
    advanceClock();
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: first.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });
    const reboarded = await getIncidentExport(db, shop.id, reef.id, staff.id);
    expect(
      reboarded?.roster
        .find((row) => row.bookingId === first.booking.id)
        ?.certificationsAtCapture?.find((row) => row.identifier === "BOARD-CARD"),
    ).toMatchObject({ status: "pending" });
    const savedAt = nowDate();
    advanceClock();
    const offline = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: first.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded" as const,
      source: "offline" as const,
      clientEventId: "99999999-9999-4999-8999-999999999999",
      occurredAt: nowDate(),
      offlineSnapshotSavedAt: savedAt,
    };
    expect(await recordRollCall(db, offline)).toMatchObject({ ok: true });
    const afterOffline = await getIncidentExport(db, shop.id, reef.id, staff.id);
    expect(
      afterOffline?.roster.find((row) => row.bookingId === first.booking.id)
        ?.certificationsAtCapture,
    ).toBeNull();
    advanceClock();
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: first.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });
    expect(await recordRollCall(db, offline)).toMatchObject({ ok: true, duplicate: true });
    const afterReplay = await getIncidentExport(db, shop.id, reef.id, staff.id);
    expect(
      afterReplay?.roster
        .find((row) => row.bookingId === first.booking.id)
        ?.certificationsAtCapture?.find((row) => row.identifier === "BOARD-CARD"),
    ).toMatchObject({ status: "pending" });
  });
  it("erases a reviewer from another seat's snapshot and removes the subject's snapshot", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    const [reviewer] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Former reviewer" })
      .returning();
    if (!reviewer) throw new Error("reviewer missing");
    const [event] = await db
      .insert(rollCallEvents)
      .values({
        shopId: shop.id,
        tripId: reef.id,
        bookingId: first.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "departure",
        source: "live",
        occurredAt: nowDate(),
        certificationSnapshotStartedAt: nowDate(),
        certificationSnapshotCapturedAt: nowDate(),
        certificationSnapshot: [
          {
            kind: "level",
            agency: "padi",
            level: "rescue",
            specialty: null,
            identifier: "PRIVATE-CARD",
            status: "verified",
            reviewedAt: nowDate().toISOString(),
            reviewedByName: reviewer.fullName,
            reviewedByPersonId: reviewer.id,
            imported: false,
            selfDeclared: false,
          },
        ],
      })
      .returning();
    if (!event) throw new Error("event missing");
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: reviewer.id, actorPersonId: staff.id }),
    ).toMatchObject({ ok: true });
    const [scrubbedReviewer] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, event.id));
    expect(scrubbedReviewer?.certificationSnapshot?.[0]).toMatchObject({
      reviewedByName: null,
      reviewedByPersonId: null,
      identifier: "PRIVATE-CARD",
    });
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: first.person.id,
        actorPersonId: staff.id,
      }),
    ).toMatchObject({ ok: true });
    const [scrubbedDiver] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, event.id));
    expect(scrubbedDiver?.certificationSnapshot).toBeNull();
  });
  it("erases a merged reviewer's name captured by a later boarding", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    const [source, survivor] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Former reviewer", dateOfBirth: "1980-04-02" },
        { shopId: shop.id, fullName: "Former reviewer", dateOfBirth: "1980-04-02" },
      ])
      .returning();
    if (!source || !survivor) throw new Error("reviewers missing");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: first.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "MERGED-REVIEWER-CARD",
      status: "verified",
      reviewedAt: nowDate(),
      reviewedByPersonId: source.id,
    });
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: staff.id,
      }),
    ).toMatchObject({ ok: true });
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: first.booking.id });
    if (!issued.ok) throw new Error("waiver missing");
    await completeWaiver(db, issued.token, {
      signerName: first.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    const board = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: first.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
    });
    if (!board.ok) throw new Error("boarding refused");
    const [before] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, board.eventId));
    expect(
      before?.certificationSnapshot?.find((card) => card.identifier === "MERGED-REVIEWER-CARD"),
    ).toMatchObject({ reviewedByPersonId: source.id, reviewedByName: "Former reviewer" });
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: survivor.id, actorPersonId: staff.id }),
    ).toMatchObject({ ok: true });
    const [after] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, board.eventId));
    expect(
      after?.certificationSnapshot?.find((card) => card.identifier === "MERGED-REVIEWER-CARD"),
    ).toMatchObject({ reviewedByPersonId: null, reviewedByName: null });
    advanceClock();
    const later = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: first.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
    });
    if (!later.ok) throw new Error("later boarding refused");
    const [laterEvent] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, later.eventId));
    expect(
      laterEvent?.certificationSnapshot?.find((card) => card.identifier === "MERGED-REVIEWER-CARD"),
    ).toMatchObject({ reviewedByPersonId: null, reviewedByName: null });
  });
  it("erases a boarded then cancelled seat left on a merged-away diver", async () => {
    const { db, shop, reef, staff } = await exportContext();
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    await db
      .update(people)
      .set({ dateOfBirth: "1980-04-02" })
      .where(eq(people.id, first.person.id));
    const [survivor] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: first.person.fullName, dateOfBirth: "1980-04-02" })
      .returning();
    if (!survivor) throw new Error("survivor missing");
    await db.insert(personRoles).values({ personId: survivor.id, role: "diver" });
    await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: reef.id, personId: survivor.id, bookedAs: "diver" });
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: first.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "LEFT-BEHIND-CARD",
      status: "verified",
    });
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: first.booking.id });
    if (!issued.ok) throw new Error("waiver missing");
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
    if (!boarded.ok) throw new Error("boarding refused");
    // Correct an accidental dock mark before the boat leaves; the earlier
    // event and its snapshot remain in the append-only history.
    advanceClock();
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: first.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).toMatchObject({ ok: true });
    advanceClock(Math.max(1, reef.endsAt.getTime() - nowDate().getTime() + 2 * 60 * 60 * 1000));
    expect(await cancelBooking(db, shop.id, first.booking.id)).toMatchObject({ ok: true });
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: first.person.id,
        survivorId: survivor.id,
        actorPersonId: staff.id,
      }),
    ).toMatchObject({ ok: true });
    const [left] = await db.select().from(bookings).where(eq(bookings.id, first.booking.id));
    expect(left?.personId).toBe(first.person.id);
    const [before] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, boarded.eventId));
    expect(
      before?.certificationSnapshot?.find((card) => card.identifier === "LEFT-BEHIND-CARD"),
    ).toBeDefined();
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: survivor.id, actorPersonId: staff.id }),
    ).toMatchObject({ ok: true });
    const [after] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, boarded.eventId));
    expect(after?.certificationSnapshot).toBeNull();
    expect(after?.certificationSnapshotStartedAt).toBeNull();
    expect(after?.certificationSnapshotCapturedAt).toBeNull();
  });
});
