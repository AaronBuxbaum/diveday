// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DateRequestRow } from "@/db/course-inquiries";
import { staffTranslator } from "@/i18n/staff-messages";
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

function row(request: Partial<DateRequestRow> = {}) {
  const { container } = render(
    <ul>
      <RequestLedgerRow
        request={{ ...BASE, ...request }}
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
 * **Neither a tint nor a pill** (ADR 20260827-people-not-lists, decision 5).
 *
 * A request in a day's group because it *can* make that day used to arrive as a
 * `bg-surface-sunken` card wearing a neutral `Badge` — a second pill grammar
 * and a filled panel at rest, both of which the Clearwater language spends its
 * rules closing (20260827-clearwater-surface-language, decisions 1 and 3).
 *
 * Since this row renders only under the day the diver actually named
 * (`RequestReferenceRow` carries the rest), there is no longer a soft state to
 * mark at all — so this asserts the absence, which is the whole contract.
 */
describe("a request row renders flat, in one shape", () => {
  const FILL = /\bbg-(surface-sunken|[a-z-]+-tint)\b/;
  const PILL = /\brounded-full\b/;

  it("carries no fill and no pill", () => {
    const item = row();
    expect(item.outerHTML).not.toMatch(FILL);
    expect(item.outerHTML).not.toMatch(PILL);
  });

  it("never explains why it is filed here — it is only ever filed where it asked", () => {
    row();
    expect(screen.queryByText(/First choice/)).toBeNull();
    expect(screen.queryByText(/can move a few days/)).toBeNull();
  });

  it("still says a request can move, when the diver said so", () => {
    row({ dateFlexible: true });
    expect(lineOf("Flexible")).toMatch(/·\s*Flexible\s*·/);
  });
});

/** The whole text of the line holding `words`, with its no-break spaces read as spaces. */
function lineOf(words: string): string {
  const line = screen.getByText(words).closest("p");
  return (line?.textContent ?? "").replaceAll(" ", " ");
}

/**
 * **A fact stays whole when its line wraps** (pixel-craft class 8, K-462).
 * The facts were one joined string and the number bare text, so a 230px body
 * beside a 112px "Create a booking" column split "Asked Fri, Jul" from "17"
 * and "+1-305-555-" from "0433" — four split units in one capture at 390.
 * Each whole fact and the number are their own unbreakable run now, where the
 * diver is up to is a phrase and wraps like one, and each separator is glued
 * to what it follows, so a line breaks only after a dot. And below `sm` the
 * row is `stacked`: the booking link drops beneath the request, which takes
 * the row's whole width.
 */
describe("where a request's lines may break", () => {
  const unbroken = (words: string) => screen.getByText(words).closest(".whitespace-nowrap");

  it("keeps each whole fact on one line, and lets the experience phrase wrap", () => {
    row({ dateFlexible: true });
    expect(unbroken("2 divers")).not.toBeNull();
    expect(unbroken("Flexible")).not.toBeNull();
    expect(unbroken("Asked Sat, Feb 20")).not.toBeNull();
    expect(unbroken("Certified, can share certification record")).toBeNull();
  });

  it("keeps the diver's number on one line", () => {
    row({});
    expect(unbroken("+1-305-555-0433")).not.toBeNull();
  });

  it("glues every separator to what it follows, so no line starts with a dot", () => {
    row({ dateFlexible: true });
    for (const line of [
      screen.getByText("2 divers").closest("p"),
      screen.getByText("+1-305-555-0433").closest("p"),
    ]) {
      const text = line?.textContent ?? "";
      const dots = [...text.matchAll(/·/g)];
      expect(dots.length, "the line has separators to check").toBeGreaterThanOrEqual(1);
      for (const dot of dots) {
        expect(text[(dot.index ?? 0) - 1], `before the dot at ${dot.index}`).toBe(" ");
      }
    }
  });

  it("drops the booking link beneath the request below sm, at the row's full width", () => {
    const item = row({});
    expect(item).toHaveClass("max-sm:flex-wrap");
    const book = screen.getByRole("link", { name: "Create a booking" });
    const slot = [...item.children].find((child) => child.contains(book));
    expect(slot).toHaveClass("max-sm:order-3", "max-sm:basis-full");
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
    expect(lineOf("2 divers")).toMatch(/^2 divers · Certified, can share certification record/);
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
    // Left exactly as the diver typed it: this column is their own text, not a
    // normalised `people.phone` (#1712).
    expect(screen.getByText(/\+1-305-555-0433/)).toBeTruthy();
  });

  it("groups a number a diver typed as one unbroken run", () => {
    row({ phone: "+13055550433" });
    expect(screen.getByText(/\+1 305 555 0433/)).toBeTruthy();
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

  /**
   * **Both of the row's own links are thumb-sized, and neither grows its
   * line** (principles.md §2; pixel-craft class 7, K-458). The name was a
   * 121×24 target and each address a 17px one (188×17, 182×17, 177×17 at 390).
   * A `min-h-11` box would push every line under it 20px down, so each link
   * keeps its line and stretches its `::after` to 44px — the name's 24px flex
   * box by 10px a side, the address's 20px inline block by 12.
   */
  it("gives the diver link a 44px target that overhangs its 24px line", () => {
    row({ personId: "aaaaaaaa-1111-4222-8333-444444444444" });
    expect(screen.getByRole("link", { name: "Tomás Ferreira" })).toHaveClass(
      "relative",
      "after:absolute",
      "after:inset-x-0",
      "after:-inset-y-2.5",
    );
  });

  it("gives the address a 44px target that overhangs its 20px line, as one box", () => {
    row({});
    const email = screen.getByRole("link", { name: "tomas.ferreira@example.com" });
    // One box, not an inline run: an inline link split over two lines would
    // stretch its overlay across the gap between them.
    expect(email).toHaveClass("relative", "inline-block", "max-w-full", "wrap-anywhere");
    expect(email).toHaveClass("after:absolute", "after:inset-x-0", "after:-inset-y-3");
  });

  it("carries the request into the booking flow, whether or not it is linked", () => {
    row({});
    const book = screen.getByRole("link", { name: "Create a booking" });
    expect(book.getAttribute("href")).toBe(`/shop/blue-mantis/bookings/new?request=${BASE.id}`);
  });
});
