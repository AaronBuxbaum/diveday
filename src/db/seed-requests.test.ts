import { describe, expect, it } from "vitest";
import { groupDateRequests } from "@/lib/date-requests";
import { seededShopContext } from "@/test/db";
import { listDateRequestsForStaff } from "./course-inquiries";
import { dateAt } from "./seed-clock";

/**
 * The demo's request pile is a product fixture, not filler. It needs to show
 * course and ordinary-dive leads, linked and unlinked people, dated and
 * undated asks, and the preferred/alternate/flexible grouping the staff page
 * is built around. This test keeps a future seed cleanup from quietly turning
 * that surface back into one repetitive card.
 */
describe("seeded requests", () => {
  it("keeps a believable mix of leads and date-grouping states", async () => {
    const { db, shop } = await seededShopContext();
    const page = await listDateRequestsForStaff(db, shop.id);

    expect(page.total).toBe(7);
    expect(page.pageCount).toBe(1);
    expect(page.rows).toHaveLength(7);

    const courseRequests = page.rows.filter((row) => row.courseId !== null);
    const diveRequests = page.rows.filter((row) => row.courseId === null);
    expect(courseRequests).toHaveLength(3);
    expect(diveRequests).toHaveLength(4);
    expect(page.rows.every((row) => row.courseTitle || row.interest)).toBe(true);
    expect(page.rows.every((row) => row.divers === null || row.divers >= 1)).toBe(true);

    expect(page.rows.find((row) => row.name === "Priya Sharma")).toMatchObject({
      courseTitle: "Advanced Open Water Diver",
      personId: expect.any(String),
      preferredDate: dateAt(12),
    });
    expect(page.rows.find((row) => row.name === "Marisol Vega")).toMatchObject({
      courseTitle: "Open Water Diver",
      personId: null,
      email: "marisol.vega@example.com",
    });
    expect(page.rows.find((row) => row.name === null)).toMatchObject({
      courseTitle: "Nitrox Diver",
      personId: null,
      phone: "+1-786-555-0411",
      email: null,
    });

    const grouped = groupDateRequests(page.rows, (row) => row);
    const firstRequestedDay = grouped.groups.find((group) => group.date === dateAt(12));
    expect(firstRequestedDay?.entries.map((entry) => entry.match)).toEqual([
      "preferred",
      "preferred",
      "alternate",
      "nearby",
    ]);
    expect(firstRequestedDay?.groupCount).toBe(4);

    const secondRequestedDay = grouped.groups.find((group) => group.date === dateAt(19));
    expect(secondRequestedDay?.entries.map((entry) => entry.match)).toEqual([
      "preferred",
      "alternate",
    ]);
    expect(grouped.undated).toHaveLength(2);
    expect(grouped.undated.map((row) => row.name)).toEqual(
      expect.arrayContaining(["Rae Lindqvist", null]),
    );
  });
});
