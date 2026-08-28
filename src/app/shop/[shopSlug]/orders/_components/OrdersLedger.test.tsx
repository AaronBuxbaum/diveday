// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type OrderLedgerDay, type OrderLedgerRow, OrdersLedger } from "./OrdersLedger";

/**
 * The day ledger's pins for ADR 20260827-clearwater-surface-language,
 * decision 7 — the rules, never the pixels.
 *
 * The load-bearing one is the first: a group header owns the date, so no row
 * may say it again. That is the defect this slice exists for — eight of
 * Wednesday's orders each printing "Wed, Aug 26" down a column as wide as the
 * diver's name — and the only way it comes back is a row growing a date field,
 * which is what these assertions refuse.
 */
afterEach(cleanup);

const DATE = "Wed, Aug 26";

function orderRow(overrides: Partial<OrderLedgerRow> = {}): OrderLedgerRow {
  return {
    id: "order-1",
    href: "/shop/blue-mantis/orders/order-1",
    linkLabel: "Bjorn Aasen — $139.75",
    diver: "Bjorn Aasen",
    detail: "Two-Tank Reef — Molasses & French",
    status: null,
    amount: "$139.75",
    ...overrides,
  };
}

function day(overrides: Partial<OrderLedgerDay> = {}): OrderLedgerDay {
  return {
    key: "2026-08-26",
    label: DATE,
    meta: "3 orders · $412.75",
    rows: [orderRow()],
    ...overrides,
  };
}

describe("a day owns its date", () => {
  it("renders the date once, in the group header, however many rows the day holds", () => {
    render(
      <OrdersLedger
        days={[
          day({
            rows: [
              orderRow(),
              orderRow({
                id: "order-2",
                diver: "Marisol Vega",
                linkLabel: "Marisol Vega — $139.75",
              }),
              orderRow({ id: "order-3", diver: "June Park", linkLabel: "June Park — $36.00" }),
            ],
          }),
        ]}
      />,
    );

    // Three rows, one date — the whole decision in one assertion.
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByText(DATE)).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(DATE);
  });

  it("keeps the date out of the row's accessible name too", () => {
    // The stretched link's `aria-label` replaces the row's text for a screen
    // reader, so a date smuggled in there is the same repetition one layer
    // down, where no screenshot would ever show it. The day heading above the
    // list is what a screen reader hears instead.
    render(<OrdersLedger days={[day()]} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("aria-label") ?? "").not.toContain(DATE);
    }
  });

  it("gives each day its own labelled group", () => {
    render(
      <OrdersLedger
        days={[
          day(),
          day({
            key: "2026-08-25",
            label: "Tue, Aug 25",
            meta: "1 order · $340.00",
            rows: [
              orderRow({ id: "order-9", diver: "Felix Grant", linkLabel: "Felix Grant — $340.00" }),
            ],
          }),
        ]}
      />,
    );

    // A list per day, each named by that day's own heading — the structure a
    // screen reader walks, without eight landmarks for eight days.
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([DATE, "Tue, Aug 25"]);
    expect(lists[0]?.getAttribute("aria-labelledby")).toBe(headings[0]?.id);
    expect(within(lists[1] as HTMLElement).getAllByRole("listitem")).toHaveLength(1);
  });

  it("states the day's count and subtotal beside the date and nowhere else", () => {
    render(<OrdersLedger days={[day({ rows: [orderRow(), orderRow({ id: "order-2" })] })]} />);
    expect(screen.getAllByText("3 orders · $412.75")).toHaveLength(1);
  });
});

describe("a row is a diver, what they bought, and an amount", () => {
  it("renders one door per order and no button anywhere in the ledger", () => {
    render(<OrdersLedger days={[day({ rows: [orderRow(), orderRow({ id: "order-2" })] })]} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders no pill on a settled order", () => {
    // Paid is the expected state on nearly every row; a badge there is a
    // status column formatted as information (principle 9). `Badge` is the
    // page's only pill, so "no pill" is checkable as "no status word".
    render(<OrdersLedger days={[day()]} />);
    expect(screen.queryByText("Open")).toBeNull();
    expect(screen.queryByText("Paid")).toBeNull();
  });

  it("renders the pill only on the exceptional statuses", () => {
    render(
      <OrdersLedger
        days={[
          day({
            rows: [
              orderRow(),
              orderRow({
                id: "order-2",
                diver: "Diego Alvarez",
                status: { word: "Open", tone: "warning" },
              }),
            ],
          }),
        ]}
      />,
    );
    expect(screen.getAllByText("Open")).toHaveLength(1);
  });

  it("renders nothing at all where a counter sale has no departure to name", () => {
    // A dash standing in for an absent fact is a character the reader has to
    // decode; an empty slot is the same information for free.
    render(<OrdersLedger days={[day({ rows: [orderRow({ detail: null })] })]} />);
    const [row] = screen.getAllByRole("listitem");
    expect(row?.textContent).toBe("Bjorn Aasen$139.75");
  });
});
