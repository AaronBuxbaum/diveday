import { describe, expect, it } from "vitest";
import { compareDiveRecord } from "./dive-record";

describe("compareDiveRecord", () => {
  it("says nothing when the record names the same sites the plan did", () => {
    expect(
      compareDiveRecord(
        [
          { diveNumber: 1, siteName: "Coral Wall" },
          { diveNumber: 2, siteName: "Sandy Ledge" },
        ],
        [
          { diveNumber: 1, siteName: "Coral Wall" },
          { diveNumber: 2, siteName: "Sandy Ledge" },
        ],
      ),
    ).toBeNull();
  });

  it("gives both lists when a dive was recorded at a different site", () => {
    expect(
      compareDiveRecord(
        [
          { diveNumber: 1, siteName: "Coral Wall" },
          { diveNumber: 2, siteName: "Sandy Ledge" },
        ],
        [
          { diveNumber: 1, siteName: "Coral Wall" },
          { diveNumber: 2, siteName: "The Chimney" },
        ],
      ),
    ).toEqual({
      actualSiteNames: ["Coral Wall", "The Chimney"],
      plannedSiteNames: ["Coral Wall", "Sandy Ledge"],
    });
  });

  /**
   * The soft-delete case, at this layer. `executed_dives` carries `deleted_at`
   * and a partial unique index over live rows only, so the reader filters
   * deleted rows out before they reach here — which means a day whose only
   * differing record was deleted arrives looking exactly like a day that went
   * to plan, and must render as one.
   */
  it("goes quiet again when the differing record is gone", () => {
    const planned = [
      { diveNumber: 1, siteName: "Coral Wall" },
      { diveNumber: 2, siteName: "Sandy Ledge" },
    ];
    expect(compareDiveRecord(planned, [{ diveNumber: 1, siteName: "Coral Wall" }])).toBeNull();
    expect(compareDiveRecord(planned, [])).toBeNull();
  });

  it("does not read a record that named no site as a change", () => {
    expect(
      compareDiveRecord(
        [{ diveNumber: 1, siteName: "Coral Wall" }],
        [{ diveNumber: 1, siteName: null }],
      ),
    ).toBeNull();
  });

  /**
   * `trip_dives` rows are allowed to carry no site — "2 tank dive" is a real
   * published plan. A record naming one fills that blank in rather than
   * departing from it.
   */
  it("does not read a blank leg of the plan as a change", () => {
    expect(
      compareDiveRecord(
        [{ diveNumber: 1, siteName: null }],
        [{ diveNumber: 1, siteName: "The Chimney" }],
      ),
    ).toBeNull();
  });

  it("matches a record to its plan by dive number, not by position", () => {
    expect(
      compareDiveRecord(
        [
          { diveNumber: 1, siteName: "Coral Wall" },
          { diveNumber: 2, siteName: "Sandy Ledge" },
        ],
        [{ diveNumber: 2, siteName: "Coral Wall" }],
      ),
    ).toEqual({
      actualSiteNames: ["Coral Wall"],
      plannedSiteNames: ["Coral Wall", "Sandy Ledge"],
    });
  });

  it("lists each site once, in dive order, however the rows arrive", () => {
    expect(
      compareDiveRecord(
        [
          { diveNumber: 2, siteName: "Sandy Ledge" },
          { diveNumber: 1, siteName: "Coral Wall" },
        ],
        [
          { diveNumber: 3, siteName: "The Chimney" },
          { diveNumber: 1, siteName: "The Chimney" },
          { diveNumber: 2, siteName: "Sandy Ledge" },
        ],
      ),
    ).toEqual({
      actualSiteNames: ["The Chimney", "Sandy Ledge"],
      plannedSiteNames: ["Coral Wall", "Sandy Ledge"],
    });
  });
});
