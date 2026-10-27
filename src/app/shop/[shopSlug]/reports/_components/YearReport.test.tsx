// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { summarizeShopYear } from "@/lib/shop-year";
import { YearReport } from "./YearReport";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** A year with something in every part: days at sea, a boat, a site. */
const YEAR = summarizeShopYear({
  year: 2026,
  startsOn: "2026-01-01",
  endsOn: "2026-12-31",
  firstDay: "2026-01-01",
  lastDay: "2026-08-27",
  openedThisYear: false,
  today: "2026-08-27",
  divers: 23,
  monthDivers: [
    { month: "2026-02", divers: 8 },
    { month: "2026-03", divers: 15 },
  ],
  days: [
    { day: "2026-02-03", boats: 1, divers: 8, aboard: 8, seats: 10 },
    { day: "2026-03-14", boats: 2, divers: 15, aboard: 15, seats: 20 },
  ],
  boats: [{ name: "Manta", days: 2 }],
  sites: [{ siteId: "s1", name: "Palancar Gardens", times: 3, live: true }],
});

describe("YearReport", () => {
  /**
   * **One rhythm between the year's sections, and one owner of it.** The
   * strip took `mt-8`, the figures nothing, the sites `mt-10`:
   * the pixel probe measured the stack at 0/40px, and the strip's legend sat
   * about 4px above the figures' top hairline. The diver record had the same
   * shape. forms-and-controls.md's rule is `space-y-10` on the wrapper and
   * never `mt-*` on a section.
   */
  it("stacks the strip, figures and sites on one mt-8 space-y-10 wrapper, with no child carrying its own top margin", () => {
    render(<YearReport year={YEAR} locale="en-US" shopSlug="blue-mantis" t={t} />);
    const strip = screen.getByRole("region", { name: t("reports.year.stripLabel") });
    const figures = screen.getByRole("region", { name: t("reports.year.numbersLabel") });
    const sites = screen.getByRole("region", { name: t("reports.year.sitesLabel") });

    const stack = strip.parentElement;
    expect(stack).toHaveClass("mt-8", "space-y-10");
    for (const section of [figures, sites]) expect(section.parentElement).toBe(stack);
    expect(stack?.children).toHaveLength(3);
    const margined = [...(stack?.children ?? [])].filter((child) =>
      [...child.classList].some((token) => /^(mt|my|m)-/.test(token)),
    );
    expect(margined).toEqual([]);
  });
});

/** The year's money and its CSV (fourth UX review, item 25). */
describe("the year's money", () => {
  it("shows net revenue, tax and tips", () => {
    render(
      <YearReport
        year={YEAR}
        money={{
          report: { revenueCents: 1_250_000, taxCents: 87_500, tipsCents: 64_000, tipCount: 31 },
          currency: "usd",
        }}
        locale="en-US"
        shopSlug="blue-mantis"
        t={t}
      />,
    );
    const money = screen.getByRole("region", { name: "The year’s money" });
    expect(money).toHaveTextContent("Net revenue");
    expect(money).toHaveTextContent("$12,500");
    expect(money).toHaveTextContent("Tax collected");
    expect(money).toHaveTextContent("$875");
    expect(money).toHaveTextContent("31 tips, for the crew");
  });

  it("says counter sales sit outside Tax collected only in a year the counter took money", () => {
    const line = "Counter sales are not split into tax, so Tax collected leaves them out.";
    const money = (counterTaxIncludedCents: number) => ({
      report: { revenueCents: 1_250_000, taxCents: 87_500, tipsCents: 0, tipCount: 0 },
      currency: "usd",
      counterTaxIncludedCents,
    });
    const { rerender } = render(
      <YearReport year={YEAR} money={money(10_700)} locale="en-US" shopSlug="blue-mantis" t={t} />,
    );
    expect(screen.getByText(line)).toBeTruthy();
    rerender(
      <YearReport year={YEAR} money={money(0)} locale="en-US" shopSlug="blue-mantis" t={t} />,
    );
    expect(screen.queryByText(line)).toBeNull();
  });

  it("draws no money row when it is not given one", () => {
    render(<YearReport year={YEAR} locale="en-US" shopSlug="blue-mantis" t={t} />);
    expect(screen.queryByRole("region", { name: "The year’s money" })).toBeNull();
  });
});

/** Last year beside the figures, and the year's lines (fifth loop, items 25, 27, 32). */
describe("last year and the year's lines", () => {
  it("sets last year's figure under this year's, and the lines under the sentence", () => {
    render(
      <YearReport
        year={YEAR}
        lastYear={{ divers: "291 by this date in 2025", boats: "39 by this date in 2025" }}
        lines={[
          "4 days with a weather call, 6 departures called off",
          "Certifications issued here: 34 · 22 Open Water",
        ]}
        locale="en-US"
        shopSlug="blue-mantis"
        t={t}
      />,
    );
    const figures = screen.getByRole("region", { name: t("reports.year.numbersLabel") });
    expect(figures).toHaveTextContent("291 by this date in 2025");
    expect(figures).toHaveTextContent("39 by this date in 2025");
    expect(screen.getByText("Certifications issued here: 34 · 22 Open Water")).toBeTruthy();
    expect(screen.getByText("4 days with a weather call, 6 departures called off")).toBeTruthy();
  });
});
