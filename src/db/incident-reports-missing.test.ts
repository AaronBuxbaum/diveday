import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  addIncidentPerson,
  fileIncidentReport,
  saveIncidentDraft,
  startIncidentReport,
  startMissingDiverReport,
} from "./incident-reports";
import {
  complete,
  draftsBy,
  fixture,
  OTHER_SHOP,
  OTHER_TRIP,
} from "./incident-reports-test-fixtures";
import {
  incidentReportPeople,
  incidentReports,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
} from "./schema";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

describe("a missing diver report from the manifest", () => {
  const MARKED_AT = new Date("2026-07-20T15:42:00Z");

  /** One roll-call tap on the fixture's seat, as the manifest records it. */
  async function mark(
    db: AppDb,
    f: Awaited<ReturnType<typeof fixture>>,
    checkpoint: string,
    status: "boarded" | "not_boarded" | "cleared",
    occurredAt: Date,
    source: "live" | "offline" = "live",
  ) {
    await db.insert(rollCallEvents).values({
      shopId: ctx.shop.id,
      tripId: f.trip.id,
      bookingId: f.seat.booking.id,
      recordedByPersonId: f.crew.id,
      status,
      checkpoint,
      source,
      occurredAt,
    });
  }

  /** The fixture's seat as the subject of a missing diver report. */
  function seatOf(f: Awaited<ReturnType<typeof fixture>>) {
    return { kind: "diver" as const, bookingId: f.seat.booking.id };
  }

  async function reportOf(db: AppDb, reportId: string) {
    const [row] = await db
      .select({ kind: incidentReports.kind, occurredAt: incidentReports.occurredAt })
      .from(incidentReports)
      .where(eq(incidentReports.id, reportId));
    const people = await db
      .select({
        bookingId: incidentReportPeople.bookingId,
        personId: incidentReportPeople.personId,
        involvement: incidentReportPeople.involvement,
      })
      .from(incidentReportPeople)
      .where(eq(incidentReportPeople.reportId, reportId));
    return { ...row, people };
  }

  it("opens a draft of kind Missing diver, timed at the mark, naming the diver as affected", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await mark(db, f, "after_dive_1", "not_boarded", MARKED_AT);
    const input = {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    };
    const started = await startMissingDiverReport(db, input);
    if (!started.ok) throw new Error(`refused: ${started.reason}`);
    expect(await reportOf(db, started.reportId)).toEqual({
      kind: "missing_diver",
      occurredAt: MARKED_AT,
      people: [{ bookingId: f.seat.booking.id, personId: null, involvement: "affected" }],
    });
    // A second tap opens the same draft and names the diver once.
    const again = await startMissingDiverReport(db, input);
    expect(again).toEqual({ ok: true, reportId: started.reportId, reused: true });
    expect((await reportOf(db, started.reportId)).people).toHaveLength(1);
  });

  it("never folds a missing diver into the writer's draft about something else", async () => {
    // Domain review 2026-10-16, both frames: Sal's injury draft at 10:15, Ben
    // not back aboard at 13:40; the tap used to answer with the injury report.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await mark(db, f, "after_dive_1", "not_boarded", MARKED_AT);
    const injury = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!injury.ok) throw new Error("expected a draft");
    await saveIncidentDraft(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      reportId: injury.reportId,
      actorPersonId: f.crew.id,
      fields: { ...complete, occurredAt: null, kind: "injury" },
    });
    // An untouched draft of theirs is not reused either: this is its own incident.
    const untouched = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!untouched.ok) throw new Error("expected a draft");
    const started = await startMissingDiverReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error(`refused: ${started.reason}`);
    expect(started.reportId).not.toBe(injury.reportId);
    expect(started.reportId).not.toBe(untouched.reportId);
    expect(await reportOf(db, started.reportId)).toMatchObject({
      kind: "missing_diver",
      occurredAt: MARKED_AT,
    });
    const before = await reportOf(db, injury.reportId);
    expect(before.kind).toBe("injury");
    expect(before.occurredAt).toBeNull();
    expect(before.people).toEqual([]);
  });

  it("gives a second crew member the open report's writer, never a second report", async () => {
    // Domain review 2026-10-16, captain frame: two crew tapping for one missing
    // diver made two reports. The second gets who started it and nothing else;
    // an owner gets the report itself.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await db.insert(tripAssignments).values({ tripId: f.trip.id, personId: f.ashore.id });
    await mark(db, f, "after_dive_1", "not_boarded", MARKED_AT);
    const base = { shopId: shop.id, tripId: f.trip.id, subject: seatOf(f) };
    const first = await startMissingDiverReport(db, { ...base, actorPersonId: f.crew.id });
    if (!first.ok) throw new Error(`refused: ${first.reason}`);

    expect(await startMissingDiverReport(db, { ...base, actorPersonId: f.ashore.id })).toEqual({
      ok: false,
      reason: "already_started",
      startedByName: f.crew.fullName,
    });
    expect(await draftsBy(db, f.trip.id, f.ashore.id)).toBe(0);
    expect(await startMissingDiverReport(db, { ...base, actorPersonId: f.owner.id })).toEqual({
      ok: true,
      reportId: first.reportId,
      reused: true,
    });
    expect(await draftsBy(db, f.trip.id, f.owner.id)).toBe(0);
  });

  it("starts a new report once the open one no longer says Missing diver", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await mark(db, f, "after_dive_1", "not_boarded", MARKED_AT);
    const input = {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    };
    const first = await startMissingDiverReport(db, input);
    if (!first.ok) throw new Error(`refused: ${first.reason}`);
    await saveIncidentDraft(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      reportId: first.reportId,
      actorPersonId: f.crew.id,
      fields: { ...complete, kind: "near_miss" },
    });
    const second = await startMissingDiverReport(db, input);
    if (!second.ok) throw new Error(`refused: ${second.reason}`);
    expect(second.reportId).not.toBe(first.reportId);
  });

  it("answers with the filed report for the same disappearance, never a second one", async () => {
    // Domain re-review 2026-10-16, item 1: the report was filed at 10:30 and
    // the diver is still marked missing; a later tap made a duplicate. Its
    // writer or an owner gets the filed report, to add a note; anyone else
    // learns who filed it.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await db.insert(tripAssignments).values({ tripId: f.trip.id, personId: f.ashore.id });
    await mark(db, f, "after_dive_1", "not_boarded", MARKED_AT);
    const base = { shopId: shop.id, tripId: f.trip.id, subject: seatOf(f) };
    const first = await startMissingDiverReport(db, { ...base, actorPersonId: f.crew.id });
    if (!first.ok) throw new Error(`refused: ${first.reason}`);
    const target = { shopId: shop.id, tripId: f.trip.id, reportId: first.reportId };
    await saveIncidentDraft(db, {
      ...target,
      actorPersonId: f.crew.id,
      fields: { ...complete, kind: "missing_diver", occurredAt: MARKED_AT },
    });
    expect(await fileIncidentReport(db, { ...target, actorPersonId: f.owner.id })).toEqual({
      ok: true,
    });

    expect(await startMissingDiverReport(db, { ...base, actorPersonId: f.crew.id })).toEqual({
      ok: true,
      reportId: first.reportId,
      reused: true,
    });
    expect(await startMissingDiverReport(db, { ...base, actorPersonId: f.owner.id })).toEqual({
      ok: true,
      reportId: first.reportId,
      reused: true,
    });
    expect(await startMissingDiverReport(db, { ...base, actorPersonId: f.ashore.id })).toEqual({
      ok: false,
      reason: "already_filed",
      filedByName: f.owner.fullName,
    });
    expect(await draftsBy(db, f.trip.id, f.ashore.id)).toBe(0);
    expect(await draftsBy(db, f.trip.id, f.crew.id)).toBe(0);
  });

  it("starts a new report for a second disappearance, and leaves the first one alone", async () => {
    // Domain re-review 2026-10-16, item 2: missing after dive 1 at 10:00, the
    // draft at 10:05, back aboard at 10:20; missing again after dive 2 at
    // 13:00. That is a second incident, with its own report and time.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const at = (time: string) => new Date(`2026-07-20T${time}:00Z`);
    await mark(db, f, "after_dive_1", "not_boarded", at("14:00"));
    const input = {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    };
    const first = await startMissingDiverReport(db, input);
    if (!first.ok) throw new Error(`refused: ${first.reason}`);
    await db
      .update(incidentReports)
      .set({ createdAt: at("14:05") })
      .where(eq(incidentReports.id, first.reportId));
    await mark(db, f, "after_dive_1", "boarded", at("14:20"));
    await mark(db, f, "after_dive_2", "not_boarded", at("17:00"));

    const second = await startMissingDiverReport(db, input);
    if (!second.ok) throw new Error(`refused: ${second.reason}`);
    expect(second.reportId).not.toBe(first.reportId);
    expect(await reportOf(db, second.reportId)).toMatchObject({ occurredAt: at("17:00") });
    expect(await reportOf(db, first.reportId)).toMatchObject({ occurredAt: at("14:00") });
    // Its own second tap is the same second report.
    expect(await startMissingDiverReport(db, input)).toEqual({
      ok: true,
      reportId: second.reportId,
      reused: true,
    });
  });

  it("does not count a filed report from an earlier disappearance as this one's", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const at = (time: string) => new Date(`2026-07-20T${time}:00Z`);
    await mark(db, f, "after_dive_1", "not_boarded", at("14:00"));
    const input = {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    };
    const first = await startMissingDiverReport(db, input);
    if (!first.ok) throw new Error(`refused: ${first.reason}`);
    const target = { shopId: shop.id, tripId: f.trip.id, reportId: first.reportId };
    await saveIncidentDraft(db, {
      ...target,
      actorPersonId: f.crew.id,
      fields: { ...complete, kind: "missing_diver", occurredAt: at("14:00") },
    });
    expect(await fileIncidentReport(db, { ...target, actorPersonId: f.crew.id })).toEqual({
      ok: true,
    });
    await db
      .update(incidentReports)
      .set({ createdAt: at("14:05") })
      .where(eq(incidentReports.id, first.reportId));
    await mark(db, f, "after_dive_1", "boarded", at("14:20"));
    await mark(db, f, "after_dive_2", "not_boarded", at("17:00"));
    const second = await startMissingDiverReport(db, input);
    expect(second).toMatchObject({ ok: true, reused: false });
  });

  it("allows a tablet clock a few minutes fast: a report started just before the mark's time is its", async () => {
    // A boat tablet's clock may run up to five minutes ahead of the server
    // (OFFLINE_EVENT_SKEW_MS), so the mark can read 13:03 while the report
    // the crew opened on it was stamped 13:01. Same disappearance.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const at = (time: string) => new Date(`2026-07-20T${time}:00Z`);
    await mark(db, f, "after_dive_2", "not_boarded", at("17:03"), "offline");
    const input = {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    };
    const first = await startMissingDiverReport(db, input);
    if (!first.ok) throw new Error(`refused: ${first.reason}`);
    await db
      .update(incidentReports)
      .set({ createdAt: at("17:01") })
      .where(eq(incidentReports.id, first.reportId));
    expect(await startMissingDiverReport(db, input)).toEqual({
      ok: true,
      reportId: first.reportId,
      reused: true,
    });
  });

  it("is not blocked by a report that names the diver only as a witness", async () => {
    // Security re-review 2026-10-16, item 2.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await mark(db, f, "after_dive_1", "not_boarded", MARKED_AT);
    const other = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.owner.id,
    });
    if (!other.ok) throw new Error("expected a draft");
    const target = { shopId: shop.id, tripId: f.trip.id, reportId: other.reportId };
    await saveIncidentDraft(db, {
      ...target,
      actorPersonId: f.owner.id,
      fields: { ...complete, kind: "missing_diver" },
    });
    expect(
      await addIncidentPerson(db, {
        ...target,
        actorPersonId: f.owner.id,
        subject: { kind: "booking", bookingId: f.seat.booking.id },
        involvement: "witness",
      }),
    ).toEqual({ ok: true });
    const started = await startMissingDiverReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    });
    expect(started).toMatchObject({ ok: true, reused: false });
  });

  it("times the report at the earliest standing mark: an offline copy later is the same mark", async () => {
    // Domain review 2026-10-16: the live mark at 10:00, then the phone's
    // offline copy of the same alarm synced at 10:07. The diver went missing at 10:00.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const tenOClock = new Date("2026-07-20T14:00:00Z");
    await mark(db, f, "after_dive_1", "not_boarded", tenOClock);
    await mark(db, f, "after_dive_1", "not_boarded", new Date("2026-07-20T14:07:00Z"), "offline");
    const started = await startMissingDiverReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error(`refused: ${started.reason}`);
    expect((await reportOf(db, started.reportId)).occurredAt).toEqual(tenOClock);
  });

  it("times the report at the earliest standing mark across checkpoints", async () => {
    // Still missing from dive 1 at 10:00, and again at the dive 2 count at 13:00.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const tenOClock = new Date("2026-07-20T14:00:00Z");
    await mark(db, f, "after_dive_1", "not_boarded", tenOClock);
    await mark(db, f, "after_dive_2", "not_boarded", new Date("2026-07-20T17:00:00Z"));
    const started = await startMissingDiverReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error(`refused: ${started.reason}`);
    expect((await reportOf(db, started.reportId)).occurredAt).toEqual(tenOClock);
  });

  it("reads only a standing mark: not a dock 'not boarded', and not a mark taken back", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const input = {
      shopId: shop.id,
      tripId: f.trip.id,
      subject: seatOf(f),
      actorPersonId: f.crew.id,
    };
    // At the dock "not boarded" is "never left": no missing diver.
    await mark(db, f, "departure", "not_boarded", new Date("2026-07-20T12:00:00Z"));
    expect(await startMissingDiverReport(db, input)).toEqual({
      ok: false,
      reason: "not_missing",
    });
    // Marked missing after dive 1, then back aboard: nothing stands.
    await mark(db, f, "after_dive_1", "not_boarded", new Date("2026-07-20T14:00:00Z"));
    await mark(db, f, "after_dive_1", "boarded", new Date("2026-07-20T14:05:00Z"));
    expect(await startMissingDiverReport(db, input)).toEqual({
      ok: false,
      reason: "not_missing",
    });
    expect(await draftsBy(db, f.trip.id, f.crew.id)).toBe(0);
    // Missing again after dive 2: that is the mark the report is timed at, not
    // the one taken back on dive 1.
    await mark(db, f, "after_dive_2", "not_boarded", MARKED_AT);
    const started = await startMissingDiverReport(db, input);
    if (!started.ok) throw new Error(`refused: ${started.reason}`);
    expect((await reportOf(db, started.reportId)).occurredAt).toEqual(MARKED_AT);
  });

  it("opens one for a crew member marked not back aboard, naming them as affected", async () => {
    // Domain review 2026-10-16: a divemaster who did not surface is the same
    // claim about the same kind of body.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await db.insert(tripAssignments).values({ tripId: f.trip.id, personId: f.ashore.id });
    const subject = { kind: "crew" as const, personId: f.ashore.id };
    const input = { shopId: shop.id, tripId: f.trip.id, subject, actorPersonId: f.crew.id };
    expect(await startMissingDiverReport(db, input)).toEqual({ ok: false, reason: "not_missing" });
    await db.insert(rollCallCrewEvents).values({
      shopId: shop.id,
      tripId: f.trip.id,
      personId: f.ashore.id,
      recordedByPersonId: f.crew.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      occurredAt: MARKED_AT,
    });
    const started = await startMissingDiverReport(db, input);
    if (!started.ok) throw new Error(`refused: ${started.reason}`);
    expect(await reportOf(db, started.reportId)).toEqual({
      kind: "missing_diver",
      occurredAt: MARKED_AT,
      people: [{ bookingId: null, personId: f.ashore.id, involvement: "affected" }],
    });
    // Somebody not on this departure's crew is nobody's missing crew member.
    expect(
      await startMissingDiverReport(db, {
        ...input,
        subject: { kind: "crew", personId: f.owner.id },
      }),
    ).toEqual({ ok: false, reason: "not_missing" });
  });

  it("refuses staff who may not start a report, and a seat from another departure", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await mark(db, f, "after_dive_1", "not_boarded", MARKED_AT);
    expect(
      await startMissingDiverReport(db, {
        shopId: shop.id,
        tripId: f.trip.id,
        subject: seatOf(f),
        actorPersonId: f.ashore.id,
      }),
    ).toEqual({ ok: false, reason: "not_allowed" });
    expect(await draftsBy(db, f.trip.id, f.ashore.id)).toBe(0);
    expect(
      await startMissingDiverReport(db, {
        shopId: shop.id,
        tripId: f.trip.id,
        subject: { kind: "diver", bookingId: OTHER_TRIP },
        actorPersonId: f.owner.id,
      }),
    ).toEqual({ ok: false, reason: "not_missing" });
    expect(
      await startMissingDiverReport(db, {
        shopId: OTHER_SHOP,
        tripId: f.trip.id,
        subject: seatOf(f),
        actorPersonId: f.owner.id,
      }),
    ).toEqual({ ok: false, reason: "not_allowed" });
  });
});
