// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ageOnDate, birthdayCallout } from "@/lib/age";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate, nowMs } from "@/lib/clock";
import { isWaiverCode } from "@/lib/today";
import { createWaiverToken, hashWaiverToken } from "@/lib/waivers";
import { seededShopContext } from "@/test/db";
import { subscribeManifestEvents } from "./manifest-events";
import { getTripManifest, recordRollCall, updateLatestRollCallNote } from "./manifests";
import { people, rollCallEvents, waiverRecords } from "./schema";
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
