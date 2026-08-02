// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ageOnDate, birthdayCallout } from "@/lib/age";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate, nowMs } from "@/lib/clock";
import {
  isRollCallAccountedFor,
  type RollCallCheckpoint,
  rollCallCompleteness,
} from "@/lib/manifests";
import { serializeManifests } from "@/lib/offline-manifests";
import { isWaiverCode } from "@/lib/today";
import { createWaiverToken, hashWaiverToken } from "@/lib/waivers";
import { seededShopContext } from "@/test/db";
import { subscribeManifestEvents } from "./manifest-events";
import {
  getTripManifest,
  getTripManifests,
  recordCrewAttestation,
  recordRollCall,
  updateLatestRollCallNote,
} from "./manifests";
import {
  bookings,
  people,
  rollCallCrewAttestations,
  rollCallEvents,
  shops,
  tripAssignments,
  waiverRecords,
} from "./schema";
import { listRollCallGaps } from "./today";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, getCurrentWaiverTemplate, issueWaiverRequest } from "./waivers";

const clearAnswers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

async function manifestContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [booking] = await getTripRoster(db, shop.id, reef.id);
  if (!booking) throw new Error("demo booking missing");
  const template = await getCurrentWaiverTemplate(db, shop.id);
  if (!template) throw new Error("demo waiver template missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, reef, booking, template, staff: staff.person };
}

describe("trip manifest and roll call (in-memory PGlite)", () => {
  it("derives every active booking into the manifest, including blocked divers", async () => {
    // The reef trip (manifestContext's fixture) is mostly ready these days —
    // most divers sign their waiver before the boat leaves. The night dive
    // stays universally blocked instead: none of its divers carry the Night
    // specialty the trip requires, regardless of waiver status.
    const { db, shop } = await manifestContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const night = trips.find((trip) => trip.title.startsWith("Night Dive — City of Washington"));
    if (!night) throw new Error("demo night trip missing");
    const roster = await getTripRoster(db, shop.id, night.id);
    const manifest = await getTripManifest(db, shop.id, night.id);

    expect(manifest?.divers).toHaveLength(roster.length);
    expect(manifest?.summary.blocked).toBe(roster.length);
    expect(manifest?.divers.every((diver) => diver.readiness.status === "blocked")).toBe(true);
  });

  it("only records boarding after the shared readiness service clears the diver", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    const manifest = await getTripManifest(db, shop.id, reef.id);
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    expect(diver).toMatchObject({
      readiness: { status: "ready" },
      rollCall: { state: "boarded", recordedByName: staff.fullName },
    });
  });

  it("carries the counter check-in status onto the manifest, independent of roll call (task 149)", async () => {
    // Counter check-in and boat roll call are two different questions —
    // arrived vs. aboard. `checked_in` used to have exactly one reader in
    // the app (the check-in page itself); the manifest never showed it.
    const { db, shop, reef, booking } = await manifestContext();

    const beforeCheckIn = await getTripManifest(db, shop.id, reef.id);
    expect(
      beforeCheckIn?.divers.find((entry) => entry.bookingId === booking.booking.id)?.checkedIn,
    ).toBe(false);

    await db
      .update(bookings)
      .set({ status: "checked_in" })
      .where(eq(bookings.id, booking.booking.id));

    const afterCheckIn = await getTripManifest(db, shop.id, reef.id);
    const diver = afterCheckIn?.divers.find((entry) => entry.bookingId === booking.booking.id);
    // Checked in at the counter, but never boarded — the two states stay
    // independent rather than one implying the other.
    expect(diver?.checkedIn).toBe(true);
    expect(diver?.rollCall).toBeUndefined();
  });

  it("carries an imported waiver's medical mark onto the manifest, distinctly from a real review (ADR 20260724-import-waiver-acceptance)", async () => {
    const { db, shop, reef, booking, template } = await manifestContext();
    const now = nowDate();
    await db.insert(waiverRecords).values({
      shopId: shop.id,
      bookingId: null,
      personId: booking.person.id,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "completed",
      tokenHash: hashWaiverToken(createWaiverToken()),
      expiresAt: now,
      signedName: booking.person.fullName,
      signatureMethod: "imported",
      consentedAt: now,
      signedAt: now,
      medicalReviewRequired: false,
      completedAt: now,
      importedFromLabel: "Old Blue Reef Divers",
    });

    const manifest = await getTripManifest(db, shop.id, reef.id);
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    // The manifest is the surface a crew reads for a go/no-go call — an
    // imported acceptance must be visibly distinct from a real DiveDay
    // review, never folded into the same "digital" label.
    expect(diver?.medicalWaiver).toMatchObject({ source: "imported" });
    expect(diver?.readiness.blockers.some((b) => isWaiverCode(b.code))).toBe(false);
  });

  it("allows an explicit not-boarded record but refuses to board blocked evidence", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toEqual({ ok: false, reason: "not_ready" });
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        note: "Not at the dock.",
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("boards a diver whose readiness lapsed after departure at an after-dive head count", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    // The seed reef trip's first-booked diver has no waiver on file at all
    // (the rest have one pending, still blocked). At departure the readiness
    // gate refuses to board a blocked diver.
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "departure",
      }),
    ).resolves.toEqual({ ok: false, reason: "not_ready" });

    // An after-dive checkpoint is a head count of bodies on the boat, so the same
    // blocked diver can be recorded present — the "everyone accounted for" count
    // must never exclude a diver who is demonstrably aboard.
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });

    const afterDive = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(
      afterDive?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall?.state,
    ).toBe("boarded");
  });

  it("keeps departure and after-dive head counts independent", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });

    const departure = await getTripManifest(db, shop.id, reef.id, "departure");
    const afterDive = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(
      departure?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall?.state,
    ).toBe("boarded");
    expect(
      afterDive?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall,
    ).toBeUndefined();
  });

  it("clears a recorded roll call back to awaiting when staff tap the status again", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });
    const marked = await getTripManifest(db, shop.id, reef.id);
    expect(
      marked?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall?.state,
    ).toBe("not_boarded");

    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "cleared",
      occurredAt: new Date("2026-07-20T11:05:00.000Z"),
    });
    const cleared = await getTripManifest(db, shop.id, reef.id);
    expect(
      cleared?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall,
    ).toBeUndefined();
    // A cleared result has nothing to annotate, so the note save is a no-op.
    await expect(
      updateLatestRollCallNote(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        checkpoint: "departure",
        note: "late edit",
      }),
    ).resolves.toBe(false);
  });

  it("defaults later checkpoints to not boarded once a diver is left off", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "departure",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });
    const afterDive = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(
      afterDive?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall,
    ).toMatchObject({ state: "not_boarded", implied: true });
  });

  it("saves a note onto the diver's latest result and no-ops while awaiting", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await expect(
      updateLatestRollCallNote(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        checkpoint: "departure",
        note: "nothing recorded yet",
      }),
    ).resolves.toBe(false);

    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "departure",
    });
    await expect(
      updateLatestRollCallNote(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        checkpoint: "departure",
        note: "Forgot fins — chasing them down",
      }),
    ).resolves.toBe(true);
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    expect(
      manifest?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall?.note,
    ).toBe("Forgot fins — chasing them down");
  });

  it("raises the manifest-events push signal when a note is actually saved, not on a no-op", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    let signalCount = 0;
    const unsubscribe = subscribeManifestEvents(shop.id, reef.id, () => {
      signalCount++;
    });
    try {
      // Nothing recorded yet, so this is the no-op branch — no signal.
      await updateLatestRollCallNote(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        checkpoint: "departure",
        note: "too early",
      });
      expect(signalCount).toBe(0);

      await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "departure",
      });
      expect(signalCount).toBe(1);

      await updateLatestRollCallNote(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        checkpoint: "departure",
        note: "Forgot fins — chasing them down",
      });
      expect(signalCount).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  it("applies an offline event once and rejects a delayed event behind newer live history", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const now = nowMs();
    const offlineInput = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded" as const,
      checkpoint: "after_dive_1" as const,
      source: "offline" as const,
      clientEventId: "11111111-1111-4111-8111-111111111111",
      offlineSnapshotSavedAt: new Date(now - 2 * 60 * 60 * 1000),
      occurredAt: new Date(now - 60 * 60 * 1000),
    };
    const first = await recordRollCall(db, offlineInput);
    const duplicate = await recordRollCall(db, offlineInput);
    expect(first).toMatchObject({ ok: true });
    expect(duplicate).toMatchObject({ ok: true, duplicate: true });
    expect(
      (await db.select().from(rollCallEvents)).filter(
        (event) => event.clientEventId === offlineInput.clientEventId,
      ),
    ).toHaveLength(1);

    await recordRollCall(db, {
      ...offlineInput,
      source: "live",
      clientEventId: undefined,
      offlineSnapshotSavedAt: undefined,
      status: "not_boarded",
      occurredAt: new Date(now - 10 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        ...offlineInput,
        clientEventId: "22222222-2222-4222-8222-222222222222",
        occurredAt: new Date(now - 30 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "newer_event_exists" });
  });

  it("raises the manifest-events push signal for a genuine write but not a duplicate replay", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    let signalCount = 0;
    const unsubscribe = subscribeManifestEvents(shop.id, reef.id, () => {
      signalCount++;
    });
    try {
      const clientEventId = "33333333-3333-4333-8333-333333333333";
      const first = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        source: "offline",
        clientEventId,
        offlineSnapshotSavedAt: nowDate(),
        occurredAt: nowDate(),
      });
      expect(first).toMatchObject({ ok: true });
      expect(signalCount).toBe(1);

      const duplicate = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        source: "offline",
        clientEventId,
        offlineSnapshotSavedAt: nowDate(),
        occurredAt: nowDate(),
      });
      expect(duplicate).toMatchObject({ ok: true, duplicate: true });
      expect(signalCount).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it("rejects invalid checkpoints and implausible offline clocks", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "after_dive_3",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_checkpoint" });

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        source: "offline",
        clientEventId: "33333333-3333-4333-8333-333333333333",
        offlineSnapshotSavedAt: new Date("2099-01-01T00:00:00.000Z"),
        occurredAt: new Date("2099-01-01T00:01:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "snapshot_invalid" });
  });
});

describe("age on the crew's boarding list (H-21)", () => {
  it("carries age, minor status, and a birthday for divers with a date on file", async () => {
    const { db, shop, reef } = await manifestContext();
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    if (!manifest) throw new Error("expected a manifest");

    // The seed gives a handful of divers a date of birth, including one
    // 13-year-old with a birthday two days out (src/db/seed.ts).
    const withAge = manifest.divers.filter((diver) => diver.age !== null);
    expect(withAge.length).toBeGreaterThan(0);

    const minors = manifest.divers.filter((diver) => diver.minor);
    expect(minors.length).toBeGreaterThan(0);
    for (const minor of minors) {
      expect(minor.age).not.toBeNull();
      expect(minor.age as number).toBeLessThan(18);
    }

    const celebrating = manifest.divers.filter((diver) => diver.birthday);
    expect(celebrating.length).toBeGreaterThan(0);
    expect(celebrating[0].birthday).toMatchObject({ status: "soon" });
  });

  it("stays silent for divers the shop has never asked — no 'unknown age' down the boat", async () => {
    const { db, shop, reef } = await manifestContext();
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    if (!manifest) throw new Error("expected a manifest");

    const withoutDate = manifest.divers.filter((diver) => diver.age === null);
    expect(withoutDate.length).toBeGreaterThan(0);
    for (const diver of withoutDate) {
      expect(diver.minor).toBe(false);
      expect(diver.birthday).toBeNull();
    }
  });

  it("never lets age become a boarding gate", async () => {
    // A minor is a fact the crew is told, not a refusal. Nothing about being
    // under 18 may add a readiness blocker of its own.
    const { db, shop, reef } = await manifestContext();
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    if (!manifest) throw new Error("expected a manifest");
    for (const diver of manifest.divers.filter((entry) => entry.minor)) {
      expect(diver.readiness.blockers.map((blocker) => blocker.code)).not.toContain("minor");
    }
  });
});

describe("age and birthdays are measured on the day of the dive", () => {
  it("uses the trip date, not the day staff happen to open the page", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    // A trip far enough out that "today" and "the day of the dive" cannot both
    // fall inside the birthday window — that gap is what makes this discriminating.
    const far = trips
      .filter((trip) => trip.startsAt.getTime() - nowMs() > 20 * 24 * 60 * 60 * 1000)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    if (!far) throw new Error("seed should contain a trip more than 20 days out");
    const [booking] = await getTripRoster(db, shop.id, far.id);
    if (!booking) throw new Error("expected a booking on that trip");

    // Born so they turn 30 exactly on the day the boat sails.
    const sailing = calendarDateInTimezone(far.startsAt, shop.timezone);
    const dateOfBirth = `${Number(sailing.slice(0, 4)) - 30}${sailing.slice(4)}`;
    await db
      .update(people)
      .set({ dateOfBirth })
      .where(and(eq(people.shopId, shop.id), eq(people.id, booking.person.id)));

    const manifest = await getTripManifest(db, shop.id, far.id, "departure");
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    if (!diver) throw new Error("diver missing from manifest");

    // Measured on the trip date: it is their birthday that day, and they are 30.
    expect(diver.birthday).toEqual({ status: "today" });
    expect(diver.age).toBe(30);
    // Measured from "now" it would be weeks away — outside the window entirely,
    // and they would still be 29. Both would be wrong on the boat.
    expect(
      birthdayCallout(dateOfBirth, calendarDateInTimezone(nowDate(), shop.timezone)),
    ).toBeNull();
    expect(ageOnDate(dateOfBirth, calendarDateInTimezone(nowDate(), shop.timezone))).toBe(29);
  });
});

/**
 * DOM-H1. Crew hold no booking, so `roll_call_events` — whose only subject
 * column is a `notNull` `bookingId` — has no id it could even record them
 * against. The interim slice is a per-checkpoint attested count that keeps the
 * checkpoint from reading complete. See ADR
 * 20260802-crew-roll-call-attestation.
 */
describe("crew aboard attestation (in-memory PGlite)", () => {
  async function boardEveryDiver(
    db: Awaited<ReturnType<typeof manifestContext>>["db"],
    shopId: string,
    tripId: string,
    staffId: string,
    checkpoint: RollCallCheckpoint,
  ) {
    const roster = await getTripRoster(db, shopId, tripId);
    for (const entry of roster) {
      const outcome = await recordRollCall(db, {
        shopId,
        tripId,
        bookingId: entry.booking.id,
        recordedByPersonId: staffId,
        // An after-dive checkpoint is a head count, so readiness never refuses
        // here — which is exactly what makes "every diver counted" reachable
        // without also fixing the seed's waiver state.
        status: "boarded",
        checkpoint,
      });
      if (!outcome.ok) throw new Error(`could not board a diver: ${outcome.reason}`);
    }
  }

  it("does not read the checkpoint complete with every diver counted and no crew attested", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    // The precondition the old rule called "complete".
    expect(manifest?.summary.awaiting).toBe(0);
    expect(manifest?.summary.totalDivers).toBeGreaterThan(0);
    // The seed crews every charter, so there really are people unaccounted for.
    expect(manifest?.crew.length).toBeGreaterThan(0);
    expect(manifest?.crewAttestation).toBeNull();
    expect(manifest?.completeness).toMatchObject({
      complete: false,
      diversAccountedFor: true,
      crewAccountedFor: false,
      reason: "crew_not_attested",
    });
  });

  it("still refuses to read complete when fewer crew are attested than the trip has assigned", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
    const before = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const assigned = before?.crew.length ?? 0;
    expect(assigned).toBeGreaterThan(1);

    await expect(
      recordCrewAttestation(db, {
        shopId: shop.id,
        tripId: reef.id,
        attestedByPersonId: staff.id,
        crewAboard: assigned - 1,
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true, crewAssigned: assigned });

    const short = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(short?.crewAttestation).toMatchObject({ crewAboard: assigned - 1 });
    expect(short?.completeness).toMatchObject({ complete: false, reason: "crew_short" });

    // Counting the last one aboard is what closes it.
    await expect(
      recordCrewAttestation(db, {
        shopId: shop.id,
        tripId: reef.id,
        attestedByPersonId: staff.id,
        crewAboard: assigned,
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });
    const closed = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(closed?.completeness).toEqual({
      complete: true,
      diversAccountedFor: true,
      crewAccountedFor: true,
      reason: null,
    });
  });

  it("is append-only: a later attestation supersedes without rewriting the earlier one", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    const first = await recordCrewAttestation(db, {
      shopId: shop.id,
      tripId: reef.id,
      attestedByPersonId: staff.id,
      crewAboard: 1,
      checkpoint: "departure",
      note: "Captain only so far.",
      occurredAt: new Date(nowMs() - 60_000),
    });
    const second = await recordCrewAttestation(db, {
      shopId: shop.id,
      tripId: reef.id,
      attestedByPersonId: staff.id,
      crewAboard: 2,
      checkpoint: "departure",
      occurredAt: nowDate(),
    });
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });

    const rows = await db
      .select()
      .from(rollCallCrewAttestations)
      .where(eq(rollCallCrewAttestations.tripId, reef.id));
    // Two rows, not one edited in place — what the boat believed at each point
    // stays readable, exactly like a roll-call event.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.crewAboard).sort()).toEqual([1, 2]);
    expect(rows.find((row) => row.crewAboard === 1)?.note).toBe("Captain only so far.");

    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    // The newest one is the current answer.
    expect(manifest?.crewAttestation).toMatchObject({ crewAboard: 2, note: null });
  });

  it("keeps each checkpoint's crew count independent", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await recordCrewAttestation(db, {
      shopId: shop.id,
      tripId: reef.id,
      attestedByPersonId: staff.id,
      crewAboard: 2,
      checkpoint: "departure",
    });

    const manifests = await getTripManifests(db, shop.id, reef.id);
    expect(manifests?.find((m) => m.checkpoint === "departure")?.crewAttestation).toMatchObject({
      crewAboard: 2,
    });
    // A count taken at the dock says nothing about who is aboard after dive one
    // — that is the whole point of an independent checkpoint.
    expect(manifests?.find((m) => m.checkpoint === "after_dive_1")?.crewAttestation).toBeNull();
  });

  it("re-opens a closed checkpoint when another crew member is assigned afterwards", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
    const assigned =
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.length ?? 0;
    await recordCrewAttestation(db, {
      shopId: shop.id,
      tripId: reef.id,
      attestedByPersonId: staff.id,
      crewAboard: assigned,
      checkpoint: "after_dive_1",
    });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness.complete,
    ).toBe(true);

    // Assign a crew member the count never covered. Completeness compares
    // against the assignment list *now*, so a stale "N of N" cannot keep the
    // checkpoint closed over a person nobody counted.
    const staffRows = await listStaff(db, shop.id);
    const assignedIds = new Set(
      (
        await db
          .select({ personId: tripAssignments.personId })
          .from(tripAssignments)
          .where(eq(tripAssignments.tripId, reef.id))
      ).map((row) => row.personId),
    );
    const extra = staffRows.find((row) => !assignedIds.has(row.person.id));
    if (!extra) throw new Error("seed should have a staff member not on this trip");
    await db.insert(tripAssignments).values({ tripId: reef.id, personId: extra.person.id });

    const reopened = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(reopened?.crew.length).toBe(assigned + 1);
    expect(reopened?.crewAttestation).toMatchObject({ crewAssigned: assigned });
    expect(reopened?.completeness).toMatchObject({ complete: false, reason: "crew_short" });
  });

  it("refuses a count from another shop, an unknown attester, a bad checkpoint, or a nonsense number", async () => {
    const { db, shop, reef, staff, booking } = await manifestContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-crew-attestation", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");

    // Tenant scoping: this shop's staff, another shop's id — the trip is not
    // theirs, so there is nothing to attest.
    await expect(
      recordCrewAttestation(db, {
        shopId: otherShop.id,
        tripId: reef.id,
        attestedByPersonId: staff.id,
        crewAboard: 2,
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

    // A diver is not staff, so they cannot sign a head count even in their own shop.
    await expect(
      recordCrewAttestation(db, {
        shopId: shop.id,
        tripId: reef.id,
        attestedByPersonId: booking.person.id,
        crewAboard: 2,
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

    await expect(
      recordCrewAttestation(db, {
        shopId: shop.id,
        tripId: reef.id,
        attestedByPersonId: staff.id,
        crewAboard: 2,
        checkpoint: "after_dive_9",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_checkpoint" });

    for (const crewAboard of [-1, 1.5, 100, Number.NaN]) {
      await expect(
        recordCrewAttestation(db, {
          shopId: shop.id,
          tripId: reef.id,
          attestedByPersonId: staff.id,
          crewAboard,
        }),
      ).resolves.toEqual({ ok: false, reason: "invalid_count" });
    }

    // Nothing was written by any of the refusals above.
    const rows = await db
      .select()
      .from(rollCallCrewAttestations)
      .where(eq(rollCallCrewAttestations.tripId, reef.id));
    expect(rows).toEqual([]);
  });

  it("never takes the denominator from the caller — it is read from the trip's own assignments", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    const assigned = (await getTripManifest(db, shop.id, reef.id))?.crew.length ?? 0;
    expect(assigned).toBeGreaterThan(0);

    // The caller supplies only how many bodies they counted. A client that
    // wanted to close a checkpoint by shrinking the denominator has no field
    // to do it with, and the stored one comes from the database.
    const outcome = await recordCrewAttestation(db, {
      shopId: shop.id,
      tripId: reef.id,
      attestedByPersonId: staff.id,
      crewAboard: 1,
    });
    expect(outcome).toMatchObject({ ok: true, crewAssigned: assigned });
    const [row] = await db
      .select()
      .from(rollCallCrewAttestations)
      .where(eq(rollCallCrewAttestations.tripId, reef.id));
    expect(row?.crewAssigned).toBe(assigned);
  });

  it("carries the attested count into the offline snapshot, and the offline copy agrees with the live one", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
    const beforeAttesting = await getTripManifests(db, shop.id, reef.id);
    if (!beforeAttesting) throw new Error("manifests missing");
    const unattestedPayload = serializeManifests(
      beforeAttesting,
      { slug: shop.slug, name: shop.name, timezone: shop.timezone },
      (blocker) => blocker.code,
    );
    const unattestedAfterDive = unattestedPayload.manifests.find(
      (entry) => entry.checkpoint === "after_dive_1",
    );
    // Nothing attested: the dock copy recomputes the same open checkpoint the
    // live page shows, rather than reading "complete" with the crew uncounted.
    expect(unattestedAfterDive?.crewAttestation).toBeUndefined();
    expect(
      rollCallCompleteness({
        totalDivers: unattestedAfterDive?.summary.totalDivers ?? 0,
        awaiting: 0,
        crewAssigned: unattestedAfterDive?.crew.length ?? 0,
        crewAttestation: null,
      }),
    ).toMatchObject({ complete: false, reason: "crew_not_attested" });

    const assigned = beforeAttesting[0]?.crew.length ?? 0;
    await recordCrewAttestation(db, {
      shopId: shop.id,
      tripId: reef.id,
      attestedByPersonId: staff.id,
      crewAboard: assigned,
      checkpoint: "after_dive_1",
    });

    const manifests = await getTripManifests(db, shop.id, reef.id);
    if (!manifests) throw new Error("manifests missing");
    const payload = serializeManifests(
      manifests,
      { slug: shop.slug, name: shop.name, timezone: shop.timezone },
      (blocker) => blocker.code,
    );
    const afterDive = payload.manifests.find((entry) => entry.checkpoint === "after_dive_1");
    expect(afterDive?.crewAttestation).toMatchObject({
      crewAboard: assigned,
      crewAssigned: assigned,
      attestedByName: staff.fullName,
    });
    // ISO string, not a Date: the snapshot is JSON before it is encrypted.
    expect(typeof afterDive?.crewAttestation?.occurredAt).toBe("string");
    // Crew person ids stay on the live manifest; the dock copy needs names.
    expect(afterDive?.crew.every((member) => !("id" in member))).toBe(true);
    // Same function the offline view calls, same answer as the live page.
    expect(
      rollCallCompleteness({
        totalDivers: afterDive?.summary.totalDivers ?? 0,
        awaiting: 0,
        crewAssigned: afterDive?.crew.length ?? 0,
        crewAttestation: afterDive?.crewAttestation
          ? {
              ...afterDive.crewAttestation,
              occurredAt: new Date(afterDive.crewAttestation.occurredAt),
            }
          : null,
      }).complete,
    ).toBe(
      manifests.find((entry) => entry.checkpoint === "after_dive_1")?.completeness.complete ??
        false,
    );
  });
});

/**
 * DOM-H3. The manifest and the Today work queue read the same roll-call rows
 * and used to reach opposite conclusions from them: Today raised a
 * top-severity `roll_call_missing_diver` row while the manifest printed "Roll
 * call complete ✦" for the same boat, because `carryForwardNotBoarded` treated
 * an after-dive `not_boarded` as an accounted-for record.
 *
 * Two safety surfaces disagreeing about whether everyone is out of the water is
 * worse than either being wrong alone, so this asserts the agreement directly
 * rather than each side's rule in isolation.
 */
describe("the manifest and Today agree about who is still in the water (DOM-H3)", () => {
  async function afterDiveContext() {
    const context = await manifestContext();
    const { db, shop, reef, staff } = context;
    const roster = await getTripRoster(db, shop.id, reef.id);
    expect(roster.length).toBeGreaterThan(1);
    // Board everyone after dive one — a head count, so readiness never refuses
    // — and leave exactly one diver marked as not back aboard.
    for (const entry of roster) {
      const outcome = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: entry.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "after_dive_1",
      });
      if (!outcome.ok) throw new Error(`could not board a diver: ${outcome.reason}`);
    }
    // The crew half is satisfied first, so the *only* thing that can hold this
    // checkpoint open below is the diver who has not come back.
    const crewAssigned = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.length;
    await recordCrewAttestation(db, {
      shopId: shop.id,
      tripId: reef.id,
      attestedByPersonId: staff.id,
      crewAboard: crewAssigned ?? 0,
      checkpoint: "after_dive_1",
    });
    // Just after the boat ties up: home, and well inside the dock-work window.
    const now = new Date(reef.endsAt.getTime() + 60_000);
    return { ...context, missing: roster[0], now };
  }

  it("holds the checkpoint open and raises the missing-diver row for the same trip", async () => {
    const { db, shop, reef, staff, missing, now } = await afterDiveContext();
    if (!missing) throw new Error("roster missing");

    // Everything closed before anyone says otherwise.
    const closed = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(closed?.completeness).toMatchObject({ complete: true, reason: null });
    expect(
      (await listRollCallGaps(db, shop.id, now)).some(
        (gap) => gap.tripId === reef.id && gap.reason === "missing_diver",
      ),
    ).toBe(false);

    // One diver did not come back from dive one.
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: missing.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    // Every diver has a result, so the old `awaiting === 0` rule called this
    // complete — which is exactly the screen that contradicted Today.
    expect(manifest?.summary.awaiting).toBe(0);
    expect(manifest?.summary.notBackAboard).toBe(1);
    expect(manifest?.summary.unaccountedFor).toBe(1);
    expect(manifest?.completeness).toMatchObject({
      complete: false,
      diversAccountedFor: false,
      crewAccountedFor: true,
      reason: "divers_not_back_aboard",
    });

    const gap = (await listRollCallGaps(db, shop.id, now)).find(
      (entry) => entry.tripId === reef.id && entry.reason === "missing_diver",
    );
    expect(gap).toBeDefined();
    expect(gap?.diveNumber).toBe(1);
    expect(gap?.uncounted).toBe(1);
    // The agreement itself, stated as one assertion: the manifest cannot read
    // closed while Today is alarming about the same boat.
    expect(manifest?.completeness.complete).toBe(gap === undefined);
  });

  it("does not let the missing diver's result close dive two either", async () => {
    const { db, shop, reef, staff, missing, now } = await afterDiveContext();
    if (!missing) throw new Error("roster missing");
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: missing.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
    });

    // Nothing carries forward from an after-dive result: dive two has to ask
    // again rather than inheriting "not boarded" as a settled answer.
    const diveTwo = await getTripManifest(db, shop.id, reef.id, "after_dive_2");
    const diverAtDiveTwo = diveTwo?.divers.find((entry) => entry.bookingId === missing.booking.id);
    expect(diverAtDiveTwo?.rollCall).toBeUndefined();
    expect(diveTwo?.completeness).toMatchObject({ reason: "divers_awaiting" });
    expect(diveTwo?.completeness.complete).toBe(false);
    // And Today still has the boat.
    expect((await listRollCallGaps(db, shop.id, now)).some((gap) => gap.tripId === reef.id)).toBe(
      true,
    );
  });

  it("still carries a departure not-boarded forward as a diver who is accounted for", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    const roster = await getTripRoster(db, shop.id, reef.id);
    const ashore = roster[0];
    if (!ashore) throw new Error("roster missing");
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: ashore.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "departure",
      }),
    ).resolves.toMatchObject({ ok: true });

    // "Never left the dock" is benign and correctly true of every later
    // checkpoint — this half of carry-forward is unchanged.
    for (const checkpoint of ["after_dive_1", "after_dive_2"] as const) {
      const manifest = await getTripManifest(db, shop.id, reef.id, checkpoint);
      const diver = manifest?.divers.find((entry) => entry.bookingId === ashore.booking.id);
      expect(diver?.rollCall).toMatchObject({ state: "not_boarded", implied: true });
      // Carried, so not a missing diver and not an awaiting one either.
      expect(manifest?.summary.notBackAboard).toBe(0);
      expect(isRollCallAccountedFor(checkpoint, diver?.rollCall)).toBe(true);
    }
  });
});
