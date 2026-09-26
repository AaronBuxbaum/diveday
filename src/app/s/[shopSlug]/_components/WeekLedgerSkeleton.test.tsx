// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WeekLedger, type WeekLedgerRow } from "./WeekLedger";
import { WeekLedgerSkeleton } from "./WeekLedgerSkeleton";

afterEach(cleanup);

function row(overrides: Partial<WeekLedgerRow> = {}): WeekLedgerRow {
  return {
    id: "trip-1",
    dayKey: "2026-08-27",
    dayParts: { day: "27", weekday: "Thu", month: "Aug" },
    href: "/s/blue-mantis/trips/trip-1",
    linkLabel: "Aug 27 · 7:00 AM – 10:30 AM · Two-Tank Reef · 3 spots left",
    timeRange: "7:00 AM – 10:30 AM",
    title: "Two-Tank Reef — Molasses & French",
    lens: null,
    course: null,
    site: "Molasses Reef and French Reef",
    requirements: ["Open Water or higher"],
    aboveLevel: null,
    clears: null,
    capacityText: "3 spots left",
    capacityTone: "quiet",
    price: "$95.00",
    ...overrides,
  };
}

/**
 * The classes that place a box — margins, padding, flex direction, gaps and
 * alignment, at every breakpoint — and none that paint it. A hover fill, a
 * sticky offset or a focus ring moves nothing, so a skeleton need not wear it.
 */
function boxClasses(element: Element | null | undefined): string {
  return (element?.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((token) =>
      /^(?:[a-z]+:)*(?:-?m[trblxy]?-|p[trblxy]?-|flex$|flex-(?:col|row)$|gap-|items-)/.test(token),
    )
    .sort()
    .join(" ");
}

/** The loaded ledger's two boxes: a day rule and the row under it. */
function loadedBoxes(): { rule: string; row: string } {
  const { container } = render(
    <WeekLedger rows={[row()]} listLabel="Upcoming trips" stickyTop="top-0" />,
  );
  const rule = container.querySelector('li[role="presentation"]');
  const item = container.querySelector("li:not([role]) > div");
  expect(rule).not.toBeNull();
  expect(item).not.toBeNull();
  return { rule: boxClasses(rule), row: boxClasses(item) };
}

/**
 * **The ledger's skeleton is drawn in the ledger's own boxes** (K-371). The
 * framed schedule is nothing but this list, so its skeleton is too; a rule or
 * a row drawn in any other box is the list jumping when it lands. Rendered
 * against the real ledger rather than against a copy of its classes, so a
 * change to either one's geometry that is not made to both goes red here.
 */
describe("the week ledger's skeleton", () => {
  it("draws two days of two rows, each in the loaded rule's and row's own box", () => {
    const loaded = loadedBoxes();
    const { container } = render(<WeekLedgerSkeleton />);
    const parts = Array.from(container.firstElementChild?.children ?? []).map((part) => {
      const box = boxClasses(part);
      return box === loaded.rule ? "rule" : box === loaded.row ? "row" : box;
    });
    expect(parts).toEqual(["rule", "row", "row", "rule", "row", "row"]);
  });

  it("keeps the list's own column, so the first rule lands where the loaded one does", () => {
    const { container: loaded } = render(
      <WeekLedger rows={[row()]} listLabel="Upcoming trips" stickyTop="top-0" />,
    );
    const list = boxClasses(loaded.querySelector("ul"));
    cleanup();
    const { container } = render(<WeekLedgerSkeleton />);
    expect(boxClasses(container.firstElementChild)).toBe(list);
  });

  it("gives each rule the loaded rule's 40px block and each row its lines' own boxes", () => {
    const { container } = render(<WeekLedgerSkeleton />);
    const [rule, row] = Array.from(container.firstElementChild?.children ?? []);
    // The weekday over the month: two `text-base leading-tight` lines, 20px each.
    expect(rule?.querySelector(".h-10")).not.toBeNull();
    // The time, the title and the seat state are 24px `text-base` lines; the
    // meta line under the title is a 20px `text-sm` one, 4px below it.
    expect(row?.querySelectorAll(".h-6")).toHaveLength(3);
    expect(row?.querySelectorAll(".mt-1.h-5")).toHaveLength(1);
  });
});
