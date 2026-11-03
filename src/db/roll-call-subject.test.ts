import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { CLIENT_EVENT_CONFLICT } from "./offline-replay";
import {
  asCrewMark,
  asSeatMark,
  crewSubject,
  markSubjectId,
  splitRollCallRows,
} from "./roll-call-subject";
import { retiredRollCallCrewEvents, rollCallEvents, tripAssignments } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **Seat and crew are one ledger** (issue #2700): `roll_call_events` holds
 * both halves of a head count behind `subject_kind`. These are the ways that
 * could go wrong — a row about nobody, a crew tap counted as a diver, a device
 * id that names one half answered as the other — each refused or kept apart.
 */

const ctx = fileScopedShopContext();
const MINUTE_MS = 60_000;

async function reefWithCrew(db: AppDb, shopId: string) {
  const trips = await upcomingTripsWithCounts(db, shopId, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [seat] = await getTripRoster(db, shopId, reef.id);
  if (!seat) throw new Error("demo reef trip has nobody on it");
  const [staff] = await listStaff(db, shopId);
  if (!staff) throw new Error("demo staff missing");
  await db
    .insert(tripAssignments)
    .values({ tripId: reef.id, personId: staff.person.id })
    .onConflictDoNothing();
  return { tripId: reef.id, bookingId: seat.booking.id, staffId: staff.person.id };
}

/** One insert in its own savepoint, so a refusal does not abort the test's transaction. */
async function refusal(db: AppDb, row: typeof rollCallEvents.$inferInsert) {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(rollCallEvents).values(row);
    });
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string } }).cause;
    return cause?.constraint ?? "unknown";
  }
  return null;
}

function offlineEvent(clientEventId: string) {
  const savedAt = new Date(nowMs() - 10 * MINUTE_MS);
  return {
    source: "offline" as const,
    clientEventId,
    offlineSnapshotSavedAt: savedAt,
    occurredAt: new Date(savedAt.getTime() + MINUTE_MS),
  };
}

describe("a roll-call mark names exactly one subject", () => {
  it("refuses a seat mark with no booking, or one that also names a crew member", async () => {
    const { db, shop } = ctx;
    const { tripId, bookingId, staffId } = await reefWithCrew(db, shop.id);
    const base = { shopId: shop.id, tripId, recordedByPersonId: staffId, occurredAt: nowDate() };
    expect(await refusal(db, { ...base, status: "boarded" })).toBe("roll_call_events_subject");
    expect(
      await refusal(db, { ...base, bookingId, crewPersonId: staffId, status: "boarded" }),
    ).toBe("roll_call_events_subject");
  });

  it("refuses a crew mark left at the seat default, or one that names a booking", async () => {
    const { db, shop } = ctx;
    const { tripId, bookingId, staffId } = await reefWithCrew(db, shop.id);
    const base = { shopId: shop.id, tripId, recordedByPersonId: staffId, occurredAt: nowDate() };
    // The default is `seat`, for the release still serving during the
    // migration; a crew writer that forgot to say `crew` is refused here.
    expect(await refusal(db, { ...base, crewPersonId: staffId, status: "boarded" })).toBe(
      "roll_call_events_subject",
    );
    expect(await refusal(db, { ...base, subjectKind: "crew", status: "boarded" })).toBe(
      "roll_call_events_subject",
    );
    expect(
      await refusal(db, {
        ...base,
        ...crewSubject(staffId),
        bookingId,
        status: "boarded",
      }),
    ).toBe("roll_call_events_subject");
  });

  it("keeps each half's evidence on its own half", async () => {
    const { db, shop } = ctx;
    const { tripId, bookingId, staffId } = await reefWithCrew(db, shop.id);
    const at = nowDate();
    const seat = {
      shopId: shop.id,
      tripId,
      bookingId,
      recordedByPersonId: staffId,
      occurredAt: at,
    };
    const crew = {
      shopId: shop.id,
      tripId,
      ...crewSubject(staffId),
      recordedByPersonId: staffId,
      occurredAt: at,
    };
    // A crew member has no readiness to snapshot, and no card evidence.
    expect(await refusal(db, { ...crew, status: "boarded", readinessStatus: "ready" })).toBe(
      "roll_call_events_readiness_snapshot_shape",
    );
    expect(
      await refusal(db, {
        ...crew,
        status: "boarded",
        certificationSnapshot: [],
        certificationSnapshotStartedAt: at,
        certificationSnapshotCapturedAt: at,
      }),
    ).toBe("roll_call_events_certification_snapshot_shape");
    expect(
      await refusal(db, {
        ...crew,
        status: "boarded",
        source: "offline",
        offlineSnapshotSavedAt: at,
      }),
    ).toBe("roll_call_events_offline_snapshot_seat_only");
    // And a diver's seat never carries a crew credential observation.
    expect(
      await refusal(db, {
        ...seat,
        status: "boarded",
        credentialSnapshot: [],
        credentialSnapshotStartedAt: at,
        credentialSnapshotCapturedAt: at,
      }),
    ).toBe("roll_call_events_credential_snapshot_shape");
    // The well-formed rows of both kinds go in.
    expect(await refusal(db, { ...seat, status: "boarded", readinessStatus: "ready" })).toBeNull();
    expect(await refusal(db, { ...crew, status: "boarded" })).toBeNull();
  });
});

describe("the two halves of one head count stay apart", () => {
  it("never counts a crew tap as a diver, nor a diver's tap as crew", async () => {
    const { db, shop } = ctx;
    const { tripId, bookingId, staffId } = await reefWithCrew(db, shop.id);
    const before = await getTripManifest(db, shop.id, tripId);
    if (!before) throw new Error("reef manifest missing");

    await expect(
      recordCrewRollCall(db, {
        shopId: shop.id,
        tripId,
        personId: staffId,
        recordedByPersonId: staffId,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });
    const crewOnly = await getTripManifest(db, shop.id, tripId);
    expect(crewOnly?.summary.boarded).toBe(before.summary.boarded);
    expect(crewOnly?.summary.awaiting).toBe(before.summary.awaiting);
    expect(crewOnly?.completeness.crewCounts.crewAwaiting).toBe(
      before.completeness.crewCounts.crewAwaiting - 1,
    );

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId,
        bookingId,
        recordedByPersonId: staffId,
        status: "not_boarded",
      }),
    ).resolves.toMatchObject({ ok: true });
    const both = await getTripManifest(db, shop.id, tripId);
    expect(both?.summary.notBoarded).toBe(before.summary.notBoarded + 1);
    expect(both?.completeness.crewCounts.crewAwaiting).toBe(
      crewOnly?.completeness.crewCounts.crewAwaiting,
    );
  });

  it("refuses a crew replay under an id a seat mark already holds, and writes nothing", async () => {
    const { db, shop } = ctx;
    const { tripId, bookingId, staffId } = await reefWithCrew(db, shop.id);
    const shared = offlineEvent(crypto.randomUUID());
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId,
        bookingId,
        recordedByPersonId: staffId,
        status: "not_boarded",
        ...shared,
      }),
    ).resolves.toMatchObject({ ok: true });

    const crewReplay = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "boarded",
      ...shared,
    });

    // Never `duplicate`: that would mark the crew tap applied when nothing
    // about the crew member was written.
    expect(crewReplay).toEqual({ ok: false, reason: CLIENT_EVENT_CONFLICT });
    const crewRows = await db
      .select({ id: rollCallEvents.id })
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.tripId, tripId), eq(rollCallEvents.crewPersonId, staffId)));
    expect(crewRows).toEqual([]);
  });

  it("refuses a seat replay under an id a crew mark already holds", async () => {
    const { db, shop } = ctx;
    const { tripId, bookingId, staffId } = await reefWithCrew(db, shop.id);
    const shared = offlineEvent(crypto.randomUUID());
    await expect(
      recordCrewRollCall(db, {
        shopId: shop.id,
        tripId,
        personId: staffId,
        recordedByPersonId: staffId,
        status: "boarded",
        ...shared,
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId,
        bookingId,
        recordedByPersonId: staffId,
        status: "boarded",
        ...shared,
      }),
    ).resolves.toEqual({ ok: false, reason: CLIENT_EVENT_CONFLICT });
    const seatRows = await db
      .select({ id: rollCallEvents.id })
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.tripId, tripId), eq(rollCallEvents.bookingId, bookingId)));
    expect(seatRows).toEqual([]);
  });

  it("answers a crew replay of its own crew mark as a duplicate", async () => {
    const { db, shop } = ctx;
    const { tripId, staffId } = await reefWithCrew(db, shop.id);
    const mark = {
      shopId: shop.id,
      tripId,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "boarded" as const,
      ...offlineEvent(crypto.randomUUID()),
    };
    const first = await recordCrewRollCall(db, mark);
    expect(first).toMatchObject({ ok: true });
    await expect(recordCrewRollCall(db, mark)).resolves.toMatchObject({
      ok: true,
      duplicate: true,
    });
  });
});

describe("an after-dive count with a diver still down", () => {
  it("stays open on the diver, however many crew are back", async () => {
    const { db, shop } = ctx;
    const { tripId, bookingId, staffId } = await reefWithCrew(db, shop.id);
    const at = nowDate();
    const seat = { shopId: shop.id, tripId, bookingId, recordedByPersonId: staffId };
    const assigned = await db
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .where(eq(tripAssignments.tripId, tripId));
    await db.insert(rollCallEvents).values([
      { ...seat, status: "boarded", checkpoint: "departure", occurredAt: at },
      { ...seat, status: "not_boarded", checkpoint: "after_dive_1", occurredAt: at },
      ...assigned.flatMap(({ personId }) =>
        ["departure", "after_dive_1"].map((checkpoint) => ({
          shopId: shop.id,
          tripId,
          ...crewSubject(personId),
          recordedByPersonId: staffId,
          status: "boarded" as const,
          checkpoint,
          occurredAt: at,
        })),
      ),
    ]);
    const manifest = await getTripManifest(db, shop.id, tripId, "after_dive_1");
    // Every crew member back is not a diver back: the seat still reads missing.
    expect(manifest?.completeness.crewCounts).toMatchObject({
      crewAwaiting: 0,
      crewNotBackAboard: 0,
    });
    expect(manifest?.summary.notBackAboard).toBe(1);
    expect(manifest?.completeness.complete).toBe(false);
  });
});

describe("the deploy-window bridge from the retired crew table", () => {
  it("forwards a crew mark the release still serving writes to the old table", async () => {
    const { db, shop } = ctx;
    const { tripId, staffId } = await reefWithCrew(db, shop.id);
    const [old] = await db
      .insert(retiredRollCallCrewEvents)
      .values({
        shopId: shop.id,
        tripId,
        personId: staffId,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt: nowDate(),
      })
      .returning({ id: retiredRollCallCrewEvents.id });
    const forwarded = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, old?.id ?? ""));
    // A crew member called "not back aboard" mid-deploy must not read as awaiting.
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({
      subjectKind: "crew",
      crewPersonId: staffId,
      bookingId: null,
      status: "not_boarded",
      checkpoint: "after_dive_1",
    });
  });

  it("carries the old release's erasure scrub and delete onto the forwarded copy", async () => {
    const { db, shop } = ctx;
    const { tripId, staffId } = await reefWithCrew(db, shop.id);
    const [old] = await db
      .insert(retiredRollCallCrewEvents)
      .values({
        shopId: shop.id,
        tripId,
        personId: staffId,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint: "departure",
        note: "Ankle strapped, said she was fine",
        credentialSnapshot: [],
        credentialSnapshotStartedAt: nowDate(),
        credentialSnapshotCapturedAt: nowDate(),
        occurredAt: nowDate(),
      })
      .returning({ id: retiredRollCallCrewEvents.id });
    const id = old?.id ?? "";
    // The release still serving erases this crew member: it scrubs only the retired row.
    // diveday:roll-call-both-subjects: reads back one row by its id.
    const copy = () => db.select().from(rollCallEvents).where(eq(rollCallEvents.id, id));
    await db
      .update(retiredRollCallCrewEvents)
      .set({
        note: null,
        credentialSnapshot: null,
        credentialSnapshotStartedAt: null,
        credentialSnapshotCapturedAt: null,
      })
      .where(eq(retiredRollCallCrewEvents.id, id));
    expect(await copy()).toMatchObject([{ note: null, credentialSnapshot: null }]);
    await db.delete(retiredRollCallCrewEvents).where(eq(retiredRollCallCrewEvents.id, id));
    expect(await copy()).toHaveLength(0);
  });
});

describe("reading a row by its subject", () => {
  const row = (subjectKind: "seat" | "crew", bookingId: string | null, crew: string | null) => ({
    subjectKind,
    bookingId,
    crewPersonId: crew,
  });

  it("names the subject of each kind", () => {
    expect(markSubjectId(row("seat", "b", null))).toBe("b");
    expect(markSubjectId(row("crew", null, "p"))).toBe("p");
  });

  it("throws rather than keying anybody under a missing id", () => {
    expect(() => markSubjectId(row("seat", null, "p"))).toThrow(/seat mark with no subject/);
    expect(() => markSubjectId(row("crew", "b", null))).toThrow(/crew mark with no subject/);
  });

  it("refuses to read one half as the other", () => {
    expect(() => asSeatMark(row("crew", null, "p"))).toThrow(/crew mark read as a seat/);
    expect(() => asCrewMark(row("seat", "b", null))).toThrow(/seat mark read as crew/);
  });

  it("splits a mixed read by kind, never by which id happens to be set", () => {
    const { seats, crew } = splitRollCallRows([
      row("seat", "b1", null),
      row("crew", null, "p1"),
      row("seat", "b2", null),
    ]);
    expect(seats.map((seat) => seat.bookingId)).toEqual(["b1", "b2"]);
    expect(crew.map((member) => member.crewPersonId)).toEqual(["p1"]);
    expect(() => splitRollCallRows([row("seat", null, "p")])).toThrow();
  });
});
