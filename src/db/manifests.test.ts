import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ageOnDate, birthdayCallout } from "@/lib/age";
import { STAFF_ROLES } from "@/lib/authz";
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
  listDepartureBoardedBookingIds,
  listDepartureBoardedByTrip,
  recordCrewRollCall,
  recordRollCall,
  updateLatestRollCallNote,
} from "./manifests";
import {
  bookings,
  people,
  personRoles,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  tripAssignments,
  userAccounts,
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

  it("answers 'who is aboard' the same way for the counter and for the departure board", async () => {
    // One reader, two shapes. `boardedCountsByTrip` (src/db/today.ts) used to
    // be a second hand-written copy of this query, and the copies had already
    // drifted: only one of them carried the cancelled-booking guard. Both
    // derive from `listDepartureBoardedByTrip` now, so a head count and a
    // per-diver badge can no longer disagree about the same booking.
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

    const byTrip = await listDepartureBoardedByTrip(db, shop.id, [reef.id]);
    const flat = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);
    expect(byTrip.get(reef.id)?.has(booking.booking.id)).toBe(true);
    expect(flat.has(booking.booking.id)).toBe(true);
    // The flat reader is exactly the grouped one, flattened — never its own query.
    expect(flat.size).toBe([...byTrip.values()].reduce((sum, set) => sum + set.size, 0));

    // A seat pulled after the count keeps its roll-call row. Counting it would
    // let the head count agree with `booked` while a real diver is still
    // ashore — the failure this guard exists to stop.
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, booking.booking.id));

    const afterCancel = await listDepartureBoardedByTrip(db, shop.id, [reef.id]);
    const afterCancelFlat = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);
    expect(afterCancel.get(reef.id)?.has(booking.booking.id) ?? false).toBe(false);
    expect(afterCancelFlat.has(booking.booking.id)).toBe(false);
  });

  it("drops a boarding that was undone, for both shapes of the aboard reader", async () => {
    // A later `cleared` is staff undoing a mistake, not a boarding that stands
    // — the same "latest event, not latest boarded event" rule the manifest
    // itself applies.
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
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "cleared",
    });

    const byTrip = await listDepartureBoardedByTrip(db, shop.id, [reef.id]);
    const flat = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);
    expect(byTrip.get(reef.id)?.has(booking.booking.id) ?? false).toBe(false);
    expect(flat.has(booking.booking.id)).toBe(false);
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

/**
 * Security review of the live-roles work (commits 78ba3c4 / 98e3bd9). The
 * writer authorized its recorder with its own `person_roles` join and checked
 * neither `people.deleted_at` nor `user_accounts.status`, so a person the shop
 * had already removed still wrote real `roll_call_events` rows — head-count
 * entries in the record of who came back from a dive, attributed to somebody
 * who is not there.
 *
 * `/api/offline-manifests/sync` refuses both cases at the door, so this was
 * never exploitable through the shipped path. It is the defence-in-depth layer:
 * `recordRollCall` is a `src/db` writer, and the next call site — a route, a
 * cron, an import — would have inherited the hole. The refusal a caller sees is
 * the writer's existing `staff_not_found`, because it is the same answer to the
 * same question: whoever is claiming to record this is not this shop's staff.
 */
describe("the roll-call recorder must be live staff (defence in depth)", () => {
  /** Rows written against this booking, whatever the checkpoint or status. */
  async function eventsFor(
    db: Awaited<ReturnType<typeof manifestContext>>["db"],
    tripId: string,
    bookingId: string,
  ) {
    return db
      .select()
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.tripId, tripId), eq(rollCallEvents.bookingId, bookingId)));
  }

  it("refuses a deleted person, and writes no roll-call row for them", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    // Removed from the roster. `removeStaffMember` soft-deletes the person and
    // does not touch `person_roles`, so the role row they were authorized by is
    // still sitting there.
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, staff.id));

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

    // The outcome that matters: a refusal that still wrote the row would be no
    // fix at all, because the row is the thing an incident report is read off.
    expect(await eventsFor(db, reef.id, booking.booking.id)).toEqual([]);
  });

  it("refuses a disabled account still holding a stale role row, and writes no roll-call row", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    // Access revoked, roster row intact — the ordinary "they left, keep the
    // history" shape. Sign-in already refuses this account; until now the
    // writer did not.
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, staff.id));
    expect(
      await db.select().from(personRoles).where(eq(personRoles.personId, staff.id)),
    ).not.toEqual([]);

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

    expect(await eventsFor(db, reef.id, booking.booking.id)).toEqual([]);
  });

  it("still lets a live staff member record, and still refuses one demoted to diver", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    // The control for both refusals above: same shop, same booking, same call
    // — only the recorder's standing differs.
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await eventsFor(db, reef.id, booking.booking.id)).toMatchObject([
      { recordedByPersonId: staff.id, status: "not_boarded" },
    ]);

    // Demotion is the case the original hand-rolled join did catch, and the
    // rewrite must keep catching it: every staff role gone, a `diver` row left.
    await db
      .delete(personRoles)
      .where(and(eq(personRoles.personId, staff.id), inArray(personRoles.role, [...STAFF_ROLES])));
    await db.insert(personRoles).values({ personId: staff.id, role: "diver" });

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });
    // Still just the one row the live staff member wrote.
    expect(await eventsFor(db, reef.id, booking.booking.id)).toHaveLength(1);
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
describe("crew emergency contacts (in-memory PGlite)", () => {
  // The glossary defines a manifest as every person on the boat *with* their
  // emergency contacts, and the printed sheet is what a coastguard reads.
  // Before this, `TripManifest["crew"]` carried no contact fields at all, so
  // the paper answered "who do we call?" for nine paying divers and for
  // neither of the two staff most reliably in the water (dive-domain review
  // 20260810). Crew are `people` rows, so nothing had to be stored — the
  // columns were already there and simply never read.
  it("carries each crew member's emergency contact off their person record", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await db
      .update(people)
      .set({
        emergencyContactName: "Marta Okonkwo (sister)",
        emergencyContactPhone: "+1-305-555-0114",
      })
      .where(eq(people.id, staff.id));
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id, tripRole: "captain" })
      .onConflictDoNothing();

    const manifest = await getTripManifest(db, shop.id, reef.id);
    const member = manifest?.crew.find((crew) => crew.id === staff.id);
    expect(member).toMatchObject({
      emergencyContactName: "Marta Okonkwo (sister)",
      emergencyContactPhone: "+1-305-555-0114",
    });
  });

  it("reads null for a crew member nobody has been asked about", async () => {
    // The ordinary state, and it must stay expressible: nobody is asked for a
    // crew contact at hire, and the row says "Not on file" in words rather
    // than printing a blank the reader has to interpret.
    const { db, shop, reef, staff } = await manifestContext();
    await db
      .update(people)
      .set({ emergencyContactName: null, emergencyContactPhone: null })
      .where(eq(people.id, staff.id));
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id, tripRole: "captain" })
      .onConflictDoNothing();

    const manifest = await getTripManifest(db, shop.id, reef.id);
    const member = manifest?.crew.find((crew) => crew.id === staff.id);
    expect(member).toMatchObject({
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
  });

  it("keeps crew contacts out of the offline snapshot", async () => {
    // The dock copy is an explicit allow-list, and it stays that way: a crew
    // contact is personal data about a colleague retained on personal phones
    // for up to 14 days, and whether it belongs there is its own decision
    // (H-21's lesson — `age`, `minor` and `birthday` reached that payload by
    // riding along on a type). The live manifest gained two fields here; the
    // snapshot deliberately gained none.
    const { db, shop, reef, staff } = await manifestContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Marta Okonkwo", emergencyContactPhone: "+1-305-555-0114" })
      .where(eq(people.id, staff.id));
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id, tripRole: "captain" })
      .onConflictDoNothing();

    const manifest = await getTripManifest(db, shop.id, reef.id);
    if (!manifest) throw new Error("manifest missing");
    const payload = serializeManifests(
      [manifest],
      { slug: shop.slug, name: shop.name, timezone: shop.timezone },
      (blocker) => blocker.code,
    );
    const crew = JSON.stringify(payload.manifests[0]?.crew);
    expect(crew).toContain(staff.fullName);
    expect(crew).not.toContain("Marta Okonkwo");
    expect(crew).not.toContain("555-0114");
  });
});

describe("crew aboard attestation (in-memory PGlite)", () => {
  // Since ADR 20260803-per-person-crew-roll-call the attested count is one of
  // two crew halves: every crew member the trip *names* also needs a result of
  // their own. Tests below that assert a checkpoint closes say both halves out
  // loud; the ones asserting it stays open are untouched.
  async function accountForEveryCrewMember(
    db: Awaited<ReturnType<typeof manifestContext>>["db"],
    shopId: string,
    tripId: string,
    staffId: string,
    checkpoint: RollCallCheckpoint,
  ) {
    const manifest = await getTripManifest(db, shopId, tripId, checkpoint);
    for (const member of manifest?.crew ?? []) {
      const outcome = await recordCrewRollCall(db, {
        shopId,
        tripId,
        personId: member.id,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint,
      });
      if (!outcome.ok) throw new Error(`could not account for crew: ${outcome.reason}`);
    }
  }

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

  it("does not read the checkpoint complete with every diver counted and the crew uncalled", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    // The precondition the old divers-only rule called "complete".
    expect(manifest?.summary.awaiting).toBe(0);
    expect(manifest?.summary.totalDivers).toBeGreaterThan(0);
    // The seed crews every charter, so there really are people unaccounted for.
    expect(manifest?.crew.length).toBeGreaterThan(0);
    expect(manifest?.completeness).toMatchObject({
      complete: false,
      diversAccountedFor: true,
      crewAccountedFor: false,
      reason: "crew_awaiting",
    });

    // Calling each of them by name is what closes it.
    await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
    ).toMatchObject({
      complete: true,
      diversAccountedFor: true,
      crewAccountedFor: true,
      reason: null,
    });
  });

  it("re-opens a closed checkpoint when another crew member is assigned afterwards", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
    const assigned =
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.length ?? 0;
    await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness.complete,
    ).toBe(true);

    // Completeness reads the assignment list *now*, so a person added after
    // the crew were called re-opens the checkpoint rather than riding on the
    // results already recorded against everybody else.
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
    expect(reopened?.completeness).toMatchObject({ complete: false, reason: "crew_awaiting" });
  });

  /**
   * The one thing an empty crew list must never be is a free pass (ADR
   * 20260804-crew-roll-call-is-per-person). It is a scheduling gap, not
   * evidence that nobody else was aboard, and the manifest answers it with
   * "Add crew to trip" rather than a number to type.
   */
  it("holds the checkpoint open on a trip with nobody on the crew at all", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
    await db.delete(tripAssignments).where(eq(tripAssignments.tripId, reef.id));

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(manifest?.crew).toEqual([]);
    expect(manifest?.completeness).toMatchObject({
      complete: false,
      diversAccountedFor: true,
      crewAccountedFor: false,
      reason: "crew_none_assigned",
      crewReason: "crew_none_assigned",
    });
  });

  /**
   * DOM-H1, the per-person rule (ADR 20260803-per-person-crew-roll-call, ADR
   * 20260804-crew-roll-call-is-per-person). Each assigned crew member is a
   * roll-call subject of their own — a `people.id`, never a booking, so
   * `roll_call_events.booking_id` stays `notNull` and the safety spine's
   * invariant is untouched.
   */
  describe("per-person crew roll call", () => {
    it("keeps the checkpoint open while a named crew member is unaccounted for", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
      const crew = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew ?? [];
      expect(crew.length).toBeGreaterThan(1);

      // Every diver is counted. The checkpoint stays open until each named
      // crew member has a result too.
      const [first, ...rest] = crew;
      if (!first) throw new Error("crew missing");
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
      ).toMatchObject({ complete: false, crewAccountedFor: false, reason: "crew_awaiting" });

      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: first.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "after_dive_1",
        }),
      ).resolves.toMatchObject({ ok: true });
      const partial = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      expect(partial?.crew.find((member) => member.id === first.id)?.rollCall).toMatchObject({
        state: "boarded",
        recordedByName: staff.fullName,
      });
      expect(partial?.completeness).toMatchObject({ complete: false, reason: "crew_awaiting" });

      for (const member of rest) {
        await recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: member.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
      ).toMatchObject({ complete: true, crewAccountedFor: true, reason: null });
    });

    it("re-opens the checkpoint when a crew member does not come back from a dive", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
      await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");
      const crew = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew ?? [];
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness.complete,
      ).toBe(true);

      const missing = crew[0];
      if (!missing) throw new Error("crew missing");
      // A later event supersedes the earlier one without rewriting it — the
      // divemaster who surfaced then went back down for a lost weight belt.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: missing.id,
          recordedByPersonId: staff.id,
          status: "not_boarded",
          checkpoint: "after_dive_1",
          occurredAt: new Date(nowMs() + 60_000),
        }),
      ).resolves.toMatchObject({ ok: true });

      const reopened = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      // Loudest reason on the boat: a human has said somebody in the water has
      // not come back.
      expect(reopened?.completeness).toMatchObject({
        complete: false,
        crewAccountedFor: false,
        reason: "crew_not_back_aboard",
      });
      // Both rows survive; nothing was edited in place.
      expect(
        await db
          .select()
          .from(rollCallCrewEvents)
          .where(eq(rollCallCrewEvents.personId, missing.id)),
      ).toHaveLength(2);
    });

    it("undoes a mis-tap with a cleared event, returning the crew member to awaiting", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const member = crew[0];
      if (!member) throw new Error("crew missing");
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      });
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "cleared",
        occurredAt: new Date(nowMs() + 60_000),
      });
      const manifest = await getTripManifest(db, shop.id, reef.id);
      expect(manifest?.crew.find((entry) => entry.id === member.id)?.rollCall).toBeUndefined();
    });

    it("carries a dock-side absence forward, and never carries an after-dive one", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const ashore = crew[0];
      if (!ashore) throw new Error("crew missing");
      // Called in sick: never left the dock, which is true of every later
      // checkpoint too — the same rule a diver's result follows (DOM-H3).
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: ashore.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "departure",
      });
      const manifests = await getTripManifests(db, shop.id, reef.id);
      const afterDive = manifests?.find((entry) => entry.checkpoint === "after_dive_1");
      const carried = afterDive?.crew.find((entry) => entry.id === ashore.id)?.rollCall;
      expect(carried).toMatchObject({ state: "not_boarded", implied: true });
      // Carried forward is *accounted for* — they are ashore, not in the water.
      expect(afterDive?.completeness.reason).not.toBe("crew_not_back_aboard");
    });

    it("refuses a subject who is not this trip's crew, another shop's trip, or a bad checkpoint", async () => {
      const { db, shop, reef, staff, booking } = await manifestContext();
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Other Shop", slug: "other-shop-crew-roll-call", timezone: "UTC" })
        .returning();
      if (!otherShop) throw new Error("second shop insert failed");
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const subject = crew[0];
      if (!subject) throw new Error("crew missing");

      // Tenant scoping, both ways round: another shop's id against this trip,
      // and this shop against a subject who was never rostered here.
      await expect(
        recordCrewRollCall(db, {
          shopId: otherShop.id,
          tripId: reef.id,
          personId: subject.id,
          recordedByPersonId: staff.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

      // A booked diver is not crew — being a person in this shop is not enough
      // to be a subject, because the rule is about the crew this trip *has*.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: booking.person.id,
          recordedByPersonId: staff.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "crew_not_assigned" });

      // ...and a diver cannot record one either.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: subject.id,
          recordedByPersonId: booking.person.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: subject.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "after_dive_9",
        }),
      ).resolves.toEqual({ ok: false, reason: "invalid_checkpoint" });

      // Nothing was written by any of the refusals above.
      expect(
        await db.select().from(rollCallCrewEvents).where(eq(rollCallCrewEvents.tripId, reef.id)),
      ).toEqual([]);
    });

    /**
     * Review 20260803, D11. The subject check proved only "assigned to this
     * trip", while `listTripCrew` reads the crew list through a `person_roles`
     * join filtered to `STAFF_ROLES`. A person who was assigned but held no
     * staff role could therefore carry roll-call events and appear in neither
     * the crew list nor the denominator — a result about somebody the head
     * count could not see. One definition of "on this trip's crew", or the two
     * halves answer differently.
     */
    it("refuses a subject who is assigned but holds no staff role, as the crew list does", async () => {
      const { db, shop, reef, staff, booking } = await manifestContext();
      // A booked diver, rostered onto the trip by a direct insert: assigned,
      // but not staff.
      await db.insert(tripAssignments).values({ tripId: reef.id, personId: booking.person.id });
      expect(
        (await getTripManifest(db, shop.id, reef.id))?.crew.some(
          (member) => member.id === booking.person.id,
        ),
      ).toBe(false);
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: booking.person.id,
          recordedByPersonId: staff.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "crew_not_assigned" });
      expect(
        await db.select().from(rollCallCrewEvents).where(eq(rollCallCrewEvents.tripId, reef.id)),
      ).toEqual([]);
    });

    /**
     * Dive-domain review 20260804. `removeStaffMember`, `setStaffRoles`, and
     * erasure all delete a person's `person_roles` rows and none of them
     * touches `trip_assignments`. The crew list read through a
     * `STAFF_ROLES`-filtered join, so somebody leaving the team dropped off
     * *every* trip they had ever crewed — including one where a human had
     * recorded that they **did not come back**. The checkpoint that was open
     * for exactly that reason then read complete, with the event rows still
     * sitting there unread.
     *
     * This is the same class as D3 (which `changeTripCrew` closed for the
     * trip-level unassign) reached through the team-management door instead.
     */
    it("keeps a former staff member on the crew list, so their result still holds the checkpoint open", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
      await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");
      const crew = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew ?? [];
      const leaver = crew.find((member) => member.id !== staff.id) ?? crew[0];
      if (!leaver) throw new Error("crew missing");

      // A divemaster who did not surface: the loudest state the manifest has.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: leaver.id,
          recordedByPersonId: staff.id,
          status: "not_boarded",
          checkpoint: "after_dive_1",
          occurredAt: new Date(nowMs() + 60_000),
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
      ).toMatchObject({ complete: false, reason: "crew_not_back_aboard" });

      // They leave the shop. Every staff role goes; the assignment does not.
      await db
        .delete(personRoles)
        .where(
          and(eq(personRoles.personId, leaver.id), inArray(personRoles.role, [...STAFF_ROLES])),
        );

      const after = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      // Still named on the boat they sailed on...
      expect(after?.crew.map((member) => member.id)).toContain(leaver.id);
      // ...and the checkpoint they are holding open is still open.
      expect(after?.completeness).toMatchObject({
        complete: false,
        crewAccountedFor: false,
        reason: "crew_not_back_aboard",
      });

      // And they can still be recorded, so the checkpoint can be closed by
      // saying what happened rather than only by deleting the person.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: leaver.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "after_dive_1",
          occurredAt: new Date(nowMs() + 120_000),
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
      ).toMatchObject({ complete: true, reason: null });
    });

    it("still refuses a former staff member who never had a result on the trip", async () => {
      // The D11 rule is unchanged in the direction that matters: history is
      // what keeps somebody visible, not merely having once been staff. A
      // rostered non-staff person with no events stays off the list and off
      // the denominator, so no checkpoint is held open by a ghost.
      const { db, shop, reef, staff, booking } = await manifestContext();
      await db.insert(tripAssignments).values({ tripId: reef.id, personId: booking.person.id });

      const manifest = await getTripManifest(db, shop.id, reef.id);
      expect(manifest?.crew.some((member) => member.id === booking.person.id)).toBe(false);
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: booking.person.id,
          recordedByPersonId: staff.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "crew_not_assigned" });
    });

    it("carries each crew member's result into the offline snapshot, without their id", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const member = crew[0];
      if (!member) throw new Error("crew missing");
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      });
      const manifests = await getTripManifests(db, shop.id, reef.id);
      if (!manifests) throw new Error("manifests missing");
      const payload = serializeManifests(
        manifests,
        { slug: shop.slug, name: shop.name, timezone: shop.timezone },
        (blocker) => blocker.code,
      );
      const departure = payload.manifests.find((entry) => entry.checkpoint === "departure");
      const saved = departure?.crew.find((entry) => entry.fullName === member.fullName);
      expect(saved?.rollCall).toMatchObject({ state: "boarded", recordedByName: staff.fullName });
      // ISO string, not a Date — the snapshot is JSON before it is encrypted.
      expect(typeof saved?.rollCall?.occurredAt).toBe("string");
      // Read-only on the dock, so no id ever needs to reach a crew phone.
      expect(departure?.crew.every((entry) => !("id" in entry))).toBe(true);
      // And the crew member nobody counted reads as awaiting there, which is
      // what makes the offline copy fail closed.
      const uncounted = departure?.crew.find((entry) => entry.fullName !== member.fullName);
      expect(uncounted?.rollCall).toBeUndefined();
    });
  });

  it("carries the crew results into the offline snapshot, and the offline copy agrees with the live one", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
    const beforeCalling = await getTripManifests(db, shop.id, reef.id);
    if (!beforeCalling) throw new Error("manifests missing");
    const uncalledPayload = serializeManifests(
      beforeCalling,
      { slug: shop.slug, name: shop.name, timezone: shop.timezone },
      (blocker) => blocker.code,
    );
    const uncalledAfterDive = uncalledPayload.manifests.find(
      (entry) => entry.checkpoint === "after_dive_1",
    );
    // Nobody called: the dock copy recomputes the same open checkpoint the
    // live page shows, rather than reading "complete" with the crew unaccounted for.
    expect(uncalledAfterDive?.crew.every((member) => member.rollCall === undefined)).toBe(true);
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: uncalledAfterDive?.summary.totalDivers ?? 0,
        awaiting: 0,
        notBackAboard: 0,
        // The dock copy derives the crew half from the snapshot's own crew
        // list, exactly as OfflineManifestView does — which is what makes an
        // older snapshot with no crew results read every crew member as
        // awaiting rather than as accounted for.
        crew: uncalledAfterDive?.crew ?? [],
      }),
    ).toMatchObject({ complete: false, reason: "crew_awaiting" });

    await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");

    const manifests = await getTripManifests(db, shop.id, reef.id);
    if (!manifests) throw new Error("manifests missing");
    const payload = serializeManifests(
      manifests,
      { slug: shop.slug, name: shop.name, timezone: shop.timezone },
      (blocker) => blocker.code,
    );
    const afterDive = payload.manifests.find((entry) => entry.checkpoint === "after_dive_1");
    expect(afterDive?.crew.every((member) => member.rollCall?.state === "boarded")).toBe(true);
    // ISO string, not a Date: the snapshot is JSON before it is encrypted.
    expect(typeof afterDive?.crew[0]?.rollCall?.occurredAt).toBe("string");
    // Crew person ids stay on the live manifest; the dock copy needs names.
    expect(afterDive?.crew.every((member) => !("id" in member))).toBe(true);
    // Same function the offline view calls, same answer as the live page.
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: afterDive?.summary.totalDivers ?? 0,
        awaiting: 0,
        notBackAboard: 0,
        crew: afterDive?.crew ?? [],
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
    for (const member of (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew ??
      []) {
      const crewOutcome = await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "after_dive_1",
      });
      if (!crewOutcome.ok) throw new Error(`could not account for crew: ${crewOutcome.reason}`);
    }
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
