import { describe, expect, it } from "vitest";
import { awayDatesText } from "./away-labels";

/** One reader of a person's days away, shared by every surface that says them. */
describe("awayDatesText", () => {
  it("names a range by its two ends, and a single day once", () => {
    expect(
      awayDatesText([{ startsOn: "2026-10-17", endsOn: "2026-10-18" }], "en-US").replace(
        /\s/g,
        " ",
      ),
    ).toBe("Sat, Oct 17 – Sun, Oct 18");
    expect(
      awayDatesText([{ startsOn: "2026-10-17", endsOn: "2026-10-17" }], "en-US").replace(
        /\s/g,
        " ",
      ),
    ).toBe("Sat, Oct 17");
  });

  it("joins several ranges, in the order given", () => {
    expect(
      awayDatesText(
        [
          { startsOn: "2026-10-17", endsOn: "2026-10-17" },
          { startsOn: "2026-10-20", endsOn: "2026-10-21" },
        ],
        "en-US",
      ).replace(/\s/g, " "),
    ).toBe("Sat, Oct 17, Tue, Oct 20 – Wed, Oct 21");
  });

  it("never moves a date by the reader's zone", () => {
    // A calendar date at the edge of the year stays on its own day.
    expect(
      awayDatesText([{ startsOn: "2026-12-31", endsOn: "2026-12-31" }], "en-US").replace(
        /\s/g,
        " ",
      ),
    ).toBe("Thu, Dec 31");
  });

  it("says it in Spanish for a Spanish reader", () => {
    expect(awayDatesText([{ startsOn: "2026-10-17", endsOn: "2026-10-18" }], "es-ES")).toMatch(
      /sáb.*17.*–.*dom.*18/,
    );
  });
});
