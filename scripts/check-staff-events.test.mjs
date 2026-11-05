import { describe, expect, it } from "vitest";
import { findUnmarkedStaffEventReads, guardsFile } from "./check-staff-events.mjs";

const lines = (source) => findUnmarkedStaffEventReads(source).findings.map((f) => f.line);

describe("a read of activity_events outside src/db", () => {
  it("is refused when it neither filters to the diver audience nor says why", () => {
    expect(
      lines(`
        db.select()
          .from(activityEvents)
          .where(eq(activityEvents.shopId, shopId));
      `),
    ).toEqual([3]);
  });

  it("passes when it filters to the diver audience", () => {
    expect(
      lines(`
        db.select()
          .from(activityEvents)
          .where(and(eq(activityEvents.shopId, shopId), eq(activityEvents.audience, "diver")));
      `),
    ).toEqual([]);
  });

  it("passes when it says why staff lines are right here", () => {
    expect(
      lines(`
        db.select()
          .from(activityEvents)
          // diveday:allow-staff-events: the owner's own digest, sent only to owners
          .where(eq(activityEvents.shopId, shopId));
      `),
    ).toEqual([]);
  });

  it("refuses a marker that gives no reason", () => {
    expect(
      lines(`
        db.select()
          .from(activityEvents)
          // diveday:allow-staff-events:
          .where(eq(activityEvents.shopId, shopId));
      `),
    ).toEqual([3]);
  });

  it("refuses a join onto the table, and raw SQL that names it", () => {
    expect(
      lines(`
        db.select().from(trips).innerJoin(activityEvents, eq(trips.shopId, activityEvents.shopId));
        sql\`select code from activity_events where shop_id = \${shopId}\`;
      `),
    ).toEqual([2, 3]);
  });

  it("never lets a neighbour's filter prove a read", () => {
    expect(
      lines(`
        db.select().from(activityEvents).where(eq(activityEvents.shopId, shopId));
        db.select()
          .from(activityEvents)
          .where(eq(activityEvents.audience, "diver"));
      `),
    ).toEqual([2]);
  });

  it("leaves a write alone", () => {
    expect(
      lines(`
        await tx.insert(activityEvents).values({ shopId, code: "desk_note", audience: "staff" });
        await tx.update(activityEvents).set({ params: {} }).where(eq(activityEvents.id, id));
      `),
    ).toEqual([]);
  });

  it("leaves a staff-audience filter refused: only the diver audience proves a read", () => {
    expect(
      lines(`
        db.select().from(activityEvents).where(eq(activityEvents.audience, "staff"));
      `),
    ).toEqual([2]);
  });
});

describe("reads that look filtered but are not (security review of layer 2, S2)", () => {
  it("refuses a read that selects everything but the diver audience", () => {
    expect(
      lines(`
        db.select().from(activityEvents).where(ne(activityEvents.audience, "diver"));
      `),
    ).toEqual([2]);
  });

  it("refuses a read that lets both audiences through", () => {
    expect(
      lines(`
        db.select()
          .from(activityEvents)
          .where(or(eq(activityEvents.audience, "diver"), eq(activityEvents.audience, "staff")));
      `),
    ).toEqual([3]);
  });

  it("refuses a filter that is only in a comment", () => {
    expect(
      lines(`
        db.select()
          .from(activityEvents)
          // filtered later: eq(activityEvents.audience, "diver")
          .where(eq(activityEvents.shopId, shopId));
      `),
    ).toEqual([3]);
  });

  it("anchors an aliased table, and accepts the alias's own diver filter", () => {
    expect(
      lines(`
        const ae = alias(activityEvents, "ae");
        db.select().from(ae).where(eq(ae.shopId, shopId));
      `),
    ).toEqual([3]);
    expect(
      lines(`
        const ae = alias(activityEvents, "ae");
        db.select().from(ae).where(eq(ae.audience, "diver"));
      `),
    ).toEqual([]);
  });

  it("anchors a namespace import", () => {
    expect(
      lines(`
        db.select().from(schema.activityEvents).where(eq(schema.activityEvents.shopId, shopId));
      `),
    ).toEqual([2]);
  });

  it("anchors raw SQL that interpolates the table", () => {
    expect(
      lines(`
        sql\`select * from \${activityEvents} where shop_id = \${shopId}\`;
      `),
    ).toEqual([2]);
  });
});

describe("which files are guarded", () => {
  it("guards source outside src/db, tests aside", () => {
    expect(guardsFile("src/app/s/[shopSlug]/page.tsx")).toBe(true);
    expect(guardsFile("src/features/weekly-digest/digest.ts")).toBe(true);
    expect(guardsFile("src/lib/catch-up.ts")).toBe(true);
    expect(guardsFile("src/db/today-catch-up.ts")).toBe(false);
    expect(guardsFile("src/features/weekly-digest/digest.test.ts")).toBe(false);
    expect(guardsFile("src/app/page.css")).toBe(false);
  });
});
