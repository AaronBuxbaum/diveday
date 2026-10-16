// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MonthMoneyDetail } from "@/db/report-lines";
import { staffTranslator } from "@/i18n/staff-messages";
import { BuddyReferrerLines } from "./MonthMoneyDetail";

afterEach(cleanup);

const t = staffTranslator("en-US");

function detail(buddyReferrers: MonthMoneyDetail["buddyReferrers"]): MonthMoneyDetail {
  return {
    lines: [],
    packageDivesOwed: { dives: 0, valueCents: 0 },
    divers: { total: 0, returning: 0 },
    out: { refundedCents: 0, discountedCents: 0, stripeFeesCents: null },
    payouts: [],
    buddyReferrers,
  };
}

/**
 * **"Priya Sharma brought 2 friends"** (fifth-loop ideas, item 41). The
 * referrer is the shop's own diver, so the name is safe to show staff, and it
 * opens their record.
 */
describe("who brought the month's buddy seats", () => {
  it("names each referrer with their friends, linking to the record", () => {
    render(
      <BuddyReferrerLines
        detail={detail([
          { personId: "p-1", fullName: "Priya Sharma", friends: 2 },
          { personId: "p-2", fullName: "Bjorn Aasen", friends: 1 },
        ])}
        t={t}
        shopSlug="blue-mantis"
      />,
    );
    const priya = screen.getByRole("link", { name: "Priya Sharma brought 2 friends" });
    expect(priya.getAttribute("href")).toBe("/shop/blue-mantis/divers/p-1");
    expect(screen.getByRole("link", { name: "Bjorn Aasen brought 1 friend" })).toBeTruthy();
  });

  it("names nobody in a month with no buddy seats", () => {
    render(<BuddyReferrerLines detail={detail([])} t={t} shopSlug="blue-mantis" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
