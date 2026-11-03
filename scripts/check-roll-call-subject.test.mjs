import { describe, expect, it } from "vitest";
import {
  findHandOrderedMarks,
  findSubjectlessReads,
  rollCallNames,
} from "./check-roll-call-subject.mjs";

const lines = (source) => findSubjectlessReads(source).findings.map((finding) => finding.line);

describe("a query on the roll-call ledger", () => {
  it("passes when it names its half", () => {
    expect(
      lines(`
        db.select()
          .from(rollCallEvents)
          .where(and(eq(rollCallEvents.shopId, shopId), seatMarks()));
        db.select()
          .from(rollCallEvents)
          .where(and(eq(rollCallEvents.shopId, shopId), crewMarks()));
      `),
    ).toEqual([]);
  });

  it("is refused when it names neither, the diver count that picks up crew", () => {
    expect(
      lines(`
        db.select({ status: rollCallEvents.status })
          .from(rollCallEvents)
          .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.tripId, tripId)));
      `),
    ).toEqual([3]);
  });

  it("is refused even when a join to bookings happens to drop the crew rows", () => {
    expect(
      lines(`
        db.select()
          .from(rollCallEvents)
          .innerJoin(bookings, eq(bookings.id, rollCallEvents.bookingId))
          .where(eq(rollCallEvents.shopId, shopId));
      `),
    ).toEqual([3]);
  });

  it("is never covered by its neighbour's filter", () => {
    expect(
      lines(`
        const a = db.select().from(rollCallEvents).where(seatMarks());
        const b = db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
      `),
    ).toEqual([3]);
  });

  it("guards a join, an update, a delete and a raw sql reference", () => {
    expect(
      lines(`
        db.select().from(bookings).leftJoin(
          rollCallEvents,
          eq(rollCallEvents.bookingId, bookings.id),
        );
        db.update(rollCallEvents).set({ note: null });
        db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
        sql\`exists (select 1 from \${rollCallEvents} where true)\`;
      `),
    ).toEqual([2, 6, 7, 8]);
  });

  it("guards an alias of the table", () => {
    const source = `
      const newer = alias(rollCallEvents, "newer");
      db.select().from(newer).where(eq(newer.tripId, tripId));
    `;
    expect(rollCallNames(source)).toEqual(["rollCallEvents", "newer"]);
    expect(lines(source)).toEqual([3]);
  });

  it("takes a reason for reading both halves", () => {
    expect(
      lines(`
        // diveday:roll-call-both-subjects: the demo shop's whole ledger goes.
        await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
      `),
    ).toEqual([]);
  });

  it("is refused when it only projects the kind rather than filtering by it", () => {
    expect(
      lines(`
        db.select({ kind: rollCallEvents.subjectKind })
          .from(rollCallEvents)
          .where(eq(rollCallEvents.shopId, shopId));
      `),
    ).toEqual([3]);
  });

  it("ignores a mention in a comment", () => {
    expect(lines(" * `.from(rollCallEvents)` is how a reader starts.")).toEqual([]);
  });
});

const ordered = (source) => findHandOrderedMarks(source).map((finding) => finding.line);

describe("the order of roll-call marks", () => {
  it("is refused when written by hand, the copy that once forgot seq", () => {
    expect(
      ordered(`
        .orderBy(desc(rollCallEvents.occurredAt), desc(rollCallEvents.createdAt))
        .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.seq));
        sql\`order by \${rollCallEvents.seq} desc\`;
      `),
    ).toEqual([2, 3, 4]);
  });

  it("is refused on an alias in a newer-mark comparison", () => {
    expect(
      ordered(`
        const newer = alias(rollCallEvents, "newer");
        or(gt(newer.occurredAt, rollCallEvents.occurredAt), gt(newer.seq, rollCallEvents.seq));
      `),
    ).toEqual([3]);
  });

  it("passes the helpers and a projection of seq for an in-memory sort", () => {
    expect(
      ordered(`
        .orderBy(...newestMarkFirst())
        .select({ seq: rollCallEvents.seq })
        // desc(rollCallEvents.seq) in a comment
      `),
    ).toEqual([]);
  });
});
