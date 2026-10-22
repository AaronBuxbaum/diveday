import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { summarizeMonth } from "@/lib/reporting";
import { monthFigureList } from "./month-figure-list";

const month = (overrides: Partial<Parameters<typeof summarizeMonth>[0]> = {}) =>
  summarizeMonth({
    trips: [],
    revenueCents: 687_600,
    taxCents: 0,
    importedPaymentCents: 0,
    importedRefundCents: 0,
    importedFinancialRecordCount: 0,
    tipsCents: 0,
    tipCount: 0,
    partnerReferredSeats: 0,
    buddyReferredSeats: 0,
    ...overrides,
  });

const revenueDetail = (report: ReturnType<typeof summarizeMonth>, locale = "en-US") =>
  monthFigureList({
    report,
    baselineReport: null,
    comparison: null,
    baselineMonthLabel: null,
    toDateDay: null,
    currency: "usd",
    locale,
    t: staffTranslator(locale),
    split: null,
    bookingsDetail: "",
    revenueOrdersHref: "/orders",
  }).find((figure) => figure.key === "revenue")?.detail;

describe("the net revenue tile's basis line", () => {
  it("names counter money, which no departure row carries, so the rows add up to it", () => {
    // Fifth loop, item 26: $6,527 of departures and $349 at the counter is the $6,876 tile.
    expect(revenueDetail(month({ counterCents: 34_900 }))).toBe(
      "For this month’s departures, plus $349 at the counter",
    );
    expect(revenueDetail(month({ counterCents: 34_900 }), "es-ES")).toMatch(/349/);
  });

  it("says only departures when the counter took nothing", () => {
    expect(revenueDetail(month())).toBe("For this month’s departures");
  });

  it("keeps the imported caveat and adds the counter after it", () => {
    const t = staffTranslator("en-US");
    const detail = revenueDetail(
      month({ counterCents: 4_000, importedPaymentCents: 2_500, importedFinancialRecordCount: 1 }),
    );
    expect(detail).toMatch(/unverified imported source record/);
    expect(detail).toBe(
      `${t("reports.metrics.revenueDetailWithImported", {
        count: 1,
        payments: "$25",
        refunds: "$0",
      })} ${t("reports.metrics.revenueCounter", { amount: "$40" })}`,
    );
  });
});

describe("the tip pool being reconciled with the crew shares", () => {
  it.each([
    [67_500, "usd", "en-US", "$675.00"],
    [67_501, "usd", "en-US", "$675.01"],
    [675, "jpy", "en-US", "¥675"],
    [67_501, "usd", "es-ES", "675,01 US$"],
  ])("keeps %i minor units exact for %s in %s", (tipsCents, currency, locale, expected) => {
    const figures = monthFigureList({
      report: month({ tipsCents, tipCount: 1 }),
      baselineReport: null,
      comparison: null,
      baselineMonthLabel: null,
      toDateDay: null,
      currency,
      locale,
      t: staffTranslator(locale),
      split: null,
      bookingsDetail: "",
      revenueOrdersHref: "/orders",
    });
    expect(figures.find((figure) => figure.key === "tips")?.value.replace(/\u00a0/g, " ")).toBe(
      expected,
    );
    expect(figures.find((figure) => figure.key === "revenue")?.value).not.toMatch(/[.,]00(?:\D|$)/);
  });
});
