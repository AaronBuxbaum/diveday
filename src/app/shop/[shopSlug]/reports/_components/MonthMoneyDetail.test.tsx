// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MonthMoneyDetail as Detail } from "@/db/report-lines";
import { staffTranslator } from "@/i18n/staff-messages";
import { BuddyReferrerLines, MoneyByLine, MonthFootnotes } from "./MonthMoneyDetail";

afterEach(cleanup);

const t = staffTranslator("en-US");
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function detail(over: Partial<Detail> = {}): Detail {
  return {
    lines: [{ line: "funDives", cents: 120_000 }],
    packageDivesOwed: { dives: 0, valueCents: 0 },
    divers: { total: 0, returning: 0 },
    out: {
      refundedCents: 4_000,
      discountedCents: 2_500,
      stripeFeesCents: 3_100,
      disputesLostCents: 0,
    },
    payouts: [],
    buddyReferrers: [],
    counterTaxIncludedCents: 0,
    ...over,
  };
}

/**
 * Issue #2466: refunded, discounted and Stripe-fee lines are on the paid-in-the-month
 * basis of "Money in, by line", so they render inside that section and not under the
 * departure-basis Revenue figure.
 */
describe("the money-out lines", () => {
  it("sit in the Money in, by line section, in the order refunded, discounted, fees", () => {
    render(<MoneyByLine detail={detail()} t={t} money={money} />);
    const section = screen.getByRole("region", { name: "Money in, by line" });
    expect(within(section).getByText("Refunded $40.00 of this month’s payments")).toBeTruthy();
    expect(within(section).getByText("Discount codes took $25.00 off")).toBeTruthy();
    expect(within(section).getByText("Stripe fees $31.00, on this month’s payouts")).toBeTruthy();
  });

  it("are left out when there is nothing to say, and a fee total of null is not $0", () => {
    render(
      <MoneyByLine
        detail={detail({
          out: {
            refundedCents: 0,
            discountedCents: 0,
            stripeFeesCents: null,
            disputesLostCents: 0,
          },
        })}
        t={t}
        money={money}
      />,
    );
    expect(screen.queryByText(/Refunded/)).toBeNull();
    expect(screen.queryByText(/Discount codes/)).toBeNull();
    expect(screen.queryByText(/Stripe fees/)).toBeNull();
  });

  it("show for a month with refunds but no revenue lines, and the section vanishes when empty", () => {
    const refundOnly = detail({
      lines: [],
      out: {
        refundedCents: 4_000,
        discountedCents: 0,
        stripeFeesCents: null,
        disputesLostCents: 0,
      },
    });
    const { container, rerender } = render(<MoneyByLine detail={refundOnly} t={t} money={money} />);
    expect(screen.getByText(/Refunded \$40\.00/)).toBeTruthy();
    rerender(
      <MoneyByLine
        detail={detail({
          lines: [],
          out: { refundedCents: 0, discountedCents: 0, stripeFeesCents: 0, disputesLostCents: 0 },
        })}
        t={t}
        money={money}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("say what lost card disputes took back, even in a month with nothing else (issue 2292)", () => {
    render(
      <MoneyByLine
        detail={detail({
          lines: [],
          out: {
            refundedCents: 0,
            discountedCents: 0,
            stripeFeesCents: null,
            disputesLostCents: 9_000,
          },
        })}
        t={t}
        money={money}
      />,
    );
    expect(screen.getByText(/Card disputes lost this month took back \$90\.00/)).toBeTruthy();
  });

  it("are no longer under the figures", () => {
    render(<MonthFootnotes taxCents={500} t={t} money={money} />);
    expect(screen.queryByText(/Refunded/)).toBeNull();
    expect(screen.queryByText(/Stripe fees/)).toBeNull();
  });
});

/**
 * **Counter money is counted tax included** (issue #2674): DiveDay holds no
 * tax rate for a shop, so the tax figure says so, and only in a month that
 * took money at the counter.
 */
describe("the counter's tax line", () => {
  const line = t("reports.counterTaxIncluded");

  it("says counter money is tax included when the month took some", () => {
    render(<MonthFootnotes taxCents={500} counterTaxIncludedCents={10_700} t={t} money={money} />);
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText(/Tax collected \$5\.00/)).toBeTruthy();
  });

  it("says nothing in a month with no counter money", () => {
    render(<MonthFootnotes taxCents={500} counterTaxIncludedCents={0} t={t} money={money} />);
    expect(screen.getByText(/Tax collected \$5\.00/)).toBeTruthy();
    expect(screen.queryByText(line)).toBeNull();
  });
});

/**
 * **"Priya Sharma brought 2 friends"** (fifth-loop ideas, item 41). The
 * referrer is the shop's own diver, so the name is safe to show staff, and it
 * opens their record.
 */
describe("who brought the month's buddy seats", () => {
  it("names each referrer with their friends, linking to the record", () => {
    render(
      <BuddyReferrerLines
        detail={detail({
          buddyReferrers: [
            { personId: "p-1", fullName: "Priya Sharma", friends: 2 },
            { personId: "p-2", fullName: "Bjorn Aasen", friends: 1 },
          ],
        })}
        t={t}
        shopSlug="blue-mantis"
      />,
    );
    const priya = screen.getByRole("link", { name: "Priya Sharma brought 2 friends" });
    expect(priya.getAttribute("href")).toBe("/shop/blue-mantis/divers/p-1");
    expect(screen.getByRole("link", { name: "Bjorn Aasen brought 1 friend" })).toBeTruthy();
  });

  it("names nobody in a month with no buddy seats", () => {
    render(
      <BuddyReferrerLines detail={detail({ buddyReferrers: [] })} t={t} shopSlug="blue-mantis" />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
