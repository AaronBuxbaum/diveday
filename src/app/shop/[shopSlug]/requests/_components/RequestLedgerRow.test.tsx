// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DateRequestRow } from "@/db/course-inquiries";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DateRequestMatch } from "@/lib/date-requests";
import { RequestLedgerRow } from "./RequestLedgerRow";

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

function row(request: Partial<DateRequestRow>, match: DateRequestMatch | null = "preferred") {
  const { container } = render(
    <ul>
      <RequestLedgerRow
        request={{ ...BASE, ...request }}
        match={match}
        locale="en-US"
        timezone="America/Cancun"
        shopSlug="blue-mantis"
        t={t}
      />
    </ul>,
  );
  const item = container.querySelector("li");
  if (!item) throw new Error("the row rendered no list item");
  return item;
}

/**
 * **A soft match is ink, not tint** (ADR 20260827-people-not-lists, decision 5).
 *
 * A second choice and a flexible neighbour are in a day's group because they
 * *can* make it, and the surface has to say so — but it used to say it with a
 * `bg-surface-sunken` card wearing a neutral `Badge`, which is a second pill
 * grammar and a filled panel at rest, both of which the Clearwater language
 * spends its rules closing (20260827-clearwater-surface-language, decisions 1
 * and 3). The words carry it now, so this asserts the *absence* as hard as the
 * presence: nothing in a request row wears a fill or a pill, in any match.
 */
describe("a soft match renders in ink, never in a tint or a pill", () => {
  const FILL = /\bbg-(surface-sunken|[a-z-]+-tint)\b/;
  const PILL = /\brounded-full\b/;

  it("states the date a fallback actually asked for, with no fill and no pill", () => {
    // Rendered in the Mar 13 group, which this request named second — so what
    // it says is the day it *did* ask for first.
    const item = row({}, "alternate");
    expect(screen.getByText(/First choice Mar 6, 2027/)).toBeTruthy();
    expect(item.outerHTML).not.toMatch(FILL);
    expect(item.outerHTML).not.toMatch(PILL);
  });

  it("says a flexible neighbour can move, with no fill and no pill", () => {
    const item = row(
      { preferredDate: "2027-03-04", alternateDate: null, dateFlexible: true },
      "nearby",
    );
    expect(screen.getByText(/can move a few days/)).toBeTruthy();
    expect(item.outerHTML).not.toMatch(FILL);
    expect(item.outerHTML).not.toMatch(PILL);
  });

  it("carries no fill on a firm ask either — the row shape is the same in every group", () => {
    const item = row({}, "preferred");
    expect(item.outerHTML).not.toMatch(FILL);
    expect(item.outerHTML).not.toMatch(PILL);
  });

  it("does not also say Flexible when the request travelled here on its flexibility", () => {
    row({ preferredDate: "2027-03-04", alternateDate: null, dateFlexible: true }, "nearby");
    expect(screen.queryByText(/·\s*Flexible\s*·/)).toBeNull();
  });
});

/**
 * The row's quiet facts, stated once each. The day above owns the date and the
 * counts; the row owns who asked and what for.
 */
describe("what one request says", () => {
  it("names the ask, the party size and where the diver is up to", () => {
    row({});
    expect(screen.getByText("Wants to dive: A two-tank on the wrecks")).toBeTruthy();
    expect(screen.getByText(/2 divers · Certified, can share certification record/)).toBeTruthy();
  });

  it("names the course when the lead came off a course page", () => {
    row({ courseId: "c1", courseTitle: "Open Water Diver", interest: null });
    expect(screen.getByText("About Open Water Diver")).toBeTruthy();
  });

  it("stands in for a diver who left no name", () => {
    row({ name: null });
    expect(screen.getByText("No name given")).toBeTruthy();
  });

  it("keeps the contact reachable: the address is the mailto, the number is beside it", () => {
    row({});
    const email = screen.getByRole("link", { name: "tomas.ferreira@example.com" });
    expect(email.getAttribute("href")).toBe("mailto:tomas.ferreira@example.com");
    expect(screen.getByText(/\+1-305-555-0433/)).toBeTruthy();
  });
});

/**
 * **The name is the door, and only when there is somewhere to go.** A lead is
 * tied to a diver on file by exact email match at capture time and never
 * back-filled (`src/db/course-inquiries.ts`), so most requests are strangers
 * with no record to open — and a row that looks tappable and is not is worse
 * than one that never claimed to be.
 */
describe("the door", () => {
  it("opens the diver record when the lead is linked to one", () => {
    row({ personId: "aaaaaaaa-1111-4222-8333-444444444444" });
    const door = screen.getByRole("link", { name: "Tomás Ferreira" });
    expect(door.getAttribute("href")).toBe(
      "/shop/blue-mantis/divers/aaaaaaaa-1111-4222-8333-444444444444",
    );
  });

  it("leaves a stranger's name as plain text", () => {
    row({});
    expect(screen.queryByRole("link", { name: "Tomás Ferreira" })).toBeNull();
    expect(screen.getByText("Tomás Ferreira")).toBeTruthy();
  });

  it("carries the request into the booking flow, whether or not it is linked", () => {
    row({});
    const book = screen.getByRole("link", { name: "Create a booking" });
    expect(book.getAttribute("href")).toBe(`/shop/blue-mantis/bookings/new?request=${BASE.id}`);
  });
});
