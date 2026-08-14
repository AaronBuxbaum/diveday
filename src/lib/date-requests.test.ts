import { describe, expect, it } from "vitest";
import { type DateRequestDates, FLEXIBLE_WINDOW_DAYS, groupDateRequests } from "./date-requests";

type Row = DateRequestDates & { id: string };

function request(id: string, dates: Partial<DateRequestDates>): Row {
  return {
    id,
    preferredDate: dates.preferredDate ?? null,
    alternateDate: dates.alternateDate ?? null,
    dateFlexible: dates.dateFlexible ?? false,
  };
}

/** A September date, zero-padded — the window tests do arithmetic on the day. */
function september(day: number): string {
  return `2026-09-${String(day).padStart(2, "0")}`;
}

function group(rows: Row[]) {
  return groupDateRequests(rows, (row) => row);
}

/** The group on one date, or a failure naming the date that was missing. */
function groupOn(rows: Row[], date: string) {
  const found = group(rows).groups.find((candidate) => candidate.date === date);
  if (!found) throw new Error(`no group on ${date}`);
  return found;
}

/** A group's rows as `id:match`, which is the whole contract in one string. */
function shape(entries: { request: Row; match: string }[]): string[] {
  return entries.map((entry) => `${entry.request.id}:${entry.match}`);
}

describe("groupDateRequests", () => {
  it("puts one group on each date a request named, earliest first", () => {
    const { groups } = group([
      request("late", { preferredDate: "2026-09-20" }),
      request("early", { preferredDate: "2026-09-12" }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-09-12", "2026-09-20"]);
    expect(shape(groups[0].entries)).toEqual(["early:preferred"]);
  });

  it("counts a request on both the date it asked for and the one it could also make", () => {
    const { groups } = group([
      request("pat", { preferredDate: "2026-09-12", alternateDate: "2026-09-19" }),
      request("sam", { preferredDate: "2026-09-19" }),
    ]);
    expect(groups.map((g) => [g.date, g.count, g.firmCount])).toEqual([
      ["2026-09-12", 1, 1],
      ["2026-09-19", 2, 1],
    ]);
    // The 19th is two people who could make it, only one of whom asked for it —
    // the distinction the staff list renders in a lighter weight.
    expect(shape(groups[1].entries)).toEqual(["sam:preferred", "pat:alternate"]);
  });

  it("never invents a group for a date nobody named", () => {
    const { groups } = group([
      request("flex", { preferredDate: "2026-09-12", dateFlexible: true }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-09-12"]);
  });

  it("lets a flexible request join every group within the window of one of its dates", () => {
    const { groups } = group([
      request("firm-14", { preferredDate: "2026-09-14" }),
      request("firm-30", { preferredDate: "2026-09-30" }),
      request("flex", { preferredDate: "2026-09-12", dateFlexible: true }),
    ]);
    const near = groups.find((candidate) => candidate.date === "2026-09-14");
    expect(shape(near?.entries ?? [])).toEqual(["firm-14:preferred", "flex:nearby"]);
    expect(near?.firmCount).toBe(1);
    // Three weeks away is not "near", flexible or not.
    const far = groups.find((candidate) => candidate.date === "2026-09-30");
    expect(shape(far?.entries ?? [])).toEqual(["firm-30:preferred"]);
  });

  it("holds the flexible window at exactly FLEXIBLE_WINDOW_DAYS, in both directions", () => {
    const inside = group([
      request("anchor-in", { preferredDate: september(12 + FLEXIBLE_WINDOW_DAYS) }),
      request("flex", { preferredDate: "2026-09-12", dateFlexible: true }),
    ]);
    expect(inside.groups.at(-1)?.count).toBe(2);

    const outside = group([
      request("anchor-out", { preferredDate: september(12 + FLEXIBLE_WINDOW_DAYS + 1) }),
      request("flex", { preferredDate: "2026-09-12", dateFlexible: true }),
    ]);
    expect(outside.groups.at(-1)?.count).toBe(1);

    const earlier = group([
      request("anchor-before", { preferredDate: september(12 - FLEXIBLE_WINDOW_DAYS) }),
      request("flex", { preferredDate: "2026-09-12", dateFlexible: true }),
    ]);
    expect(earlier.groups[0]?.count).toBe(2);
  });

  it("keeps a request out of a group it is not near, even when it is flexible", () => {
    const { groups } = group([
      request("firm", { preferredDate: "2026-09-12" }),
      request("flex", { preferredDate: "2026-10-20", dateFlexible: true }),
    ]);
    expect(shape(groups[0].entries)).toEqual(["firm:preferred"]);
  });

  it("counts a request once in a group it reaches three different ways", () => {
    // Names the 12th, is flexible around it, and its alternate is the same day:
    // one person on the 12th, recorded by the strongest claim it has.
    const twelfth = groupOn(
      [
        request("pat", {
          preferredDate: "2026-09-12",
          alternateDate: "2026-09-12",
          dateFlexible: true,
        }),
        request("sam", { preferredDate: "2026-09-13", dateFlexible: true }),
      ],
      "2026-09-12",
    );
    expect(shape(twelfth.entries)).toEqual(["pat:preferred", "sam:nearby"]);
    expect(twelfth.count).toBe(2);
  });

  it("sets a request with no date at all aside rather than forcing it into a group", () => {
    const { groups, undated } = group([
      request("dated", { preferredDate: "2026-09-12" }),
      request("prose-only", { dateFlexible: true }),
      request("prose-too", {}),
    ]);
    expect(groups).toHaveLength(1);
    expect(undated.map((row) => row.id)).toEqual(["prose-only", "prose-too"]);
  });

  it("returns nothing at all for no requests", () => {
    expect(group([])).toEqual({ groups: [], undated: [] });
  });
});
