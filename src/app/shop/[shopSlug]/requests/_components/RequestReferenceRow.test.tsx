// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DateRequestRow } from "@/db/course-inquiries";
import { staffTranslator } from "@/i18n/staff-messages";
import { RequestReferenceRow } from "./RequestReferenceRow";

afterEach(cleanup);

const t = staffTranslator("en-US");

const BASE: DateRequestRow = {
  id: "8f000000-1111-4222-8333-444444444444",
  courseId: null,
  courseTitle: null,
  interest: "A two-tank on the wrecks",
  personId: null,
  name: "Tomás Ferreira",
  email: "tomas.ferreira@example.com",
  phone: "+1-305-555-0433",
  experienceLevel: "certified",
  timing: null,
  preferredDate: "2027-03-06",
  alternateDate: "2027-03-13",
  dateFlexible: false,
  divers: 2,
  message: null,
  createdAt: new Date("2027-02-20T14:00:00.000Z"),
};

function row(
  match: "alternate" | "nearby" = "alternate",
  request: Partial<DateRequestRow> = {},
  homeDate = "2027-03-06",
) {
  const { container } = render(
    <ul>
      <RequestReferenceRow
        request={{ ...BASE, ...request }}
        match={match}
        homeDate={homeDate}
        locale="en-US"
        t={t}
      />
    </ul>,
  );
  const item = container.querySelector("li");
  if (!item) throw new Error("the reference row rendered no list item");
  return item;
}

/**
 * **The same lead, said once.**
 *
 * A request lands in every group it could make, and each of those used to print
 * the whole four-line body: five divers appeared twice on one screen, identical
 * down to the phone number. The full record renders under the day the diver
 * named (`homeDate`, `src/lib/date-requests.ts`); everywhere else it is this.
 */
describe("a request seen from a day it did not name first", () => {
  it("says who and how many, and nothing else the full row already says", () => {
    const item = row();
    expect(screen.getByText("Tomás Ferreira")).toBeTruthy();
    expect(item.textContent).toContain("2 divers");
    // None of the body that belongs to the full record.
    expect(item.textContent).not.toContain("tomas.ferreira@example.com");
    expect(item.textContent).not.toContain("A two-tank on the wrecks");
    expect(screen.queryByRole("link", { name: "Create a booking" })).toBeNull();
  });

  it("links up to the group holding the full record", () => {
    row();
    // The date is one unit on the line (src/lib/date-parts.ts): U+00A0 binds
    // the month to its day, and an accessible name keeps it.
    const up = screen.getByRole("link", { name: /First choice Mar\u00A06, 2027/ });
    expect(up.getAttribute("href")).toBe("#date-2027-03-06");
    // Inside a run of text, so colour alone may not be what marks it (axe
    // `link-in-text-block`).
    expect(up).toHaveClass("underline");
  });

  it("keeps the flexible neighbour's own words rather than claiming it asked", () => {
    row(
      "nearby",
      { preferredDate: "2027-03-04", alternateDate: null, dateFlexible: true },
      "2027-03-04",
    );
    const up = screen.getByRole("link", {
      name: /Asked for Mar\u00A04, 2027, and can move a few days/,
    });
    expect(up.getAttribute("href")).toBe("#date-2027-03-04");
  });

  it("stands in for a diver who left no name", () => {
    row("alternate", { name: null });
    expect(screen.getByText("No name given")).toBeTruthy();
  });
});
