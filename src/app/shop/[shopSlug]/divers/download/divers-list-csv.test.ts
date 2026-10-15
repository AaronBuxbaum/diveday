import { describe, expect, it } from "vitest";
import { diversListCsv } from "./divers-list-csv";

/** "Download this list (CSV)" on Divers (fourth UX review, item 27). */
describe("the divers list file", () => {
  it("writes name, email, phone and the last dive as the shop's day", () => {
    const csv = diversListCsv(
      [
        {
          fullName: "Bo Lapsed",
          email: "bo@example.test",
          phone: "+13055550142",
          // 02:00 UTC on May 2 is still May 1 in Florida.
          lastDivedAt: new Date("2029-05-02T02:00:00Z"),
        },
        { fullName: "Al Never", email: null, phone: null, lastDivedAt: null },
      ],
      "America/New_York",
    );
    expect(csv.split("\r\n")).toEqual([
      "Name,Email,Phone,Last dived",
      "Bo Lapsed,bo@example.test,+13055550142,2029-05-01",
      "Al Never,,,",
      "",
    ]);
  });

  it("never lets a diver's name open as a formula", () => {
    const csv = diversListCsv(
      [{ fullName: "=HYPERLINK(1)", email: null, phone: null, lastDivedAt: null }],
      "UTC",
    );
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});
