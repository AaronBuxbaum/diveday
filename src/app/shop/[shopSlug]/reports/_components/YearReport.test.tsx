// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { summarizeShopYear } from "@/lib/shop-year";
import { YearReport } from "./YearReport";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** A year with something in every part: days at sea, a boat, a site, a close-out. */
const YEAR = summarizeShopYear({
  year: 2026,
  firstDay: "2026-01-01",
  lastDay: "2026-08-27",
  openedThisYear: false,
  today: "2026-08-27",
  days: [
    { day: "2026-02-03", boats: 1, divers: 8, seats: 10 },
    { day: "2026-03-14", boats: 2, divers: 15, seats: 20 },
  ],
  boats: [{ name: "Manta", days: 2 }],
  sites: [{ siteId: "s1", name: "Palancar Gardens", times: 3, live: true }],
  entries: [{ day: "2026-03-14", actor: "Keiko Tanaka", divers: 15, boats: 2 }],
});

describe("YearReport", () => {
  /**
   * **One rhythm between the year's sections, and one owner of it.** The
   * strip took `mt-8`, the figures nothing, the sites and entries `mt-10`:
   * the pixel probe measured the stack at 0/40px, and the strip's legend sat
   * about 4px above the figures' top hairline. The diver record had the same
   * shape. forms-and-controls.md's rule is `space-y-10` on the wrapper and
   * never `mt-*` on a section.
   */
  it("stacks the strip, figures, sites, entries and share line on one mt-8 space-y-10 wrapper, with no child carrying its own top margin", () => {
    render(
      <YearReport year={YEAR} locale="en-US" shopSlug="blue-mantis" t={t} showsOnDiveday={false} />,
    );
    const strip = screen.getByRole("region", { name: t("reports.year.stripLabel") });
    const figures = screen.getByRole("region", { name: t("reports.year.numbersLabel") });
    const sites = screen.getByRole("region", { name: t("reports.year.sitesLabel") });
    const entries = screen.getByRole("region", { name: t("reports.year.entriesLabel") });

    const stack = strip.parentElement;
    expect(stack).toHaveClass("mt-8", "space-y-10");
    for (const section of [figures, sites, entries]) expect(section.parentElement).toBe(stack);
    expect(stack?.children).toHaveLength(5);
    const margined = [...(stack?.children ?? [])].filter((child) =>
      [...child.classList].some((token) => /^(mt|my|m)-/.test(token)),
    );
    expect(margined).toEqual([]);
  });
});
