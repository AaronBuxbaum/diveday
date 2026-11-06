// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { PaperShop } from "./PublicPaperSheet";
import { SchedulePaperSheet, type ScheduleSheetView } from "./SchedulePaperSheet";
import type { WeekLedgerRow } from "./WeekLedger";

afterEach(cleanup);

const t = diverTranslator("en-US");

const SHOP: PaperShop = {
  name: "Blue Mantis Divers",
  timezone: "America/New_York",
  contactPhone: "+1 305 555 0100",
  contactEmail: "dock@bluemantis.example",
  addressStreet: "100 Ocean Drive",
  addressLocality: "Key Largo",
  addressRegion: "FL",
  addressPostalCode: "33037",
  addressCountry: null,
};

function row(id: string, start: string, overrides: Partial<WeekLedgerRow> = {}): WeekLedgerRow {
  const startsAt = new Date(start);
  return {
    id,
    dayKey: start.slice(0, 10),
    dayParts: { day: "1", weekday: "Sat", month: "Nov" },
    href: `/s/blue-mantis/trips/${id}`,
    linkLabel: id,
    timeRange: "8:00 AM – 12:00 PM",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
    title: `Trip ${id}`,
    lens: null,
    course: null,
    site: null,
    requirements: [],
    aboveLevel: null,
    capacityText: "3 seats",
    capacityTone: "quiet",
    price: "$95",
    ...overrides,
  };
}

function sheet(rows: WeekLedgerRow[], view?: ScheduleSheetView) {
  return render(
    <SchedulePaperSheet
      shop={SHOP}
      shopSlug="blue-mantis"
      rows={rows}
      view={view}
      lead={["All times below are local to Blue Mantis Divers (Eastern Time).", null]}
      empty={t("schedule.noTrips")}
      locale="en-US"
      t={t}
      now={new Date("2026-10-30T12:00:00Z")}
    />,
  );
}

describe("the schedule on paper", () => {
  it("is shown only to the printer, and nothing on it taps", () => {
    const { container } = sheet([
      row("a", "2026-10-31T12:00:00Z", {
        course: { label: "Course session", title: "Open Water", href: "/s/x/courses/owd" },
      }),
    ]);
    const frame = container.querySelector(".paper-sheet-frame");
    expect(frame?.hasAttribute("data-paper-print-only")).toBe(true);
    expect(container.querySelectorAll("a, button, input, select, textarea")).toHaveLength(0);
    expect(container.textContent).toContain("Course session · Open Water");
  });

  it("gives each departure its year and its own daylight-saving zone", () => {
    const { container } = sheet([
      row("before", "2026-10-31T12:00:00Z"),
      row("after", "2026-11-01T13:00:00Z"),
    ]);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Saturday · Oct\s31, 2026/);
    expect(text).toMatch(/Nov\s1, 2026/);
    expect(text).toMatch(/Trip before[\s\S]*EDT|EDT[\s\S]*Trip before/);
    expect(text).toMatch(/EST[\s\S]*Trip after/);
  });

  it("says what narrowed a short list, so it is never read as the whole board", () => {
    const { container } = sheet([row("a", "2026-10-31T12:00:00Z")], {
      monthLabel: "November 2026",
      lensName: "Wreck days",
      tripTypeFilter: "fun_dive",
      hasSpaceFilter: true,
      canDiveFilter: "open_water",
      hideAboveFilter: true,
    });
    expect(container.textContent).toContain(
      [
        "November 2026",
        "Wreck days",
        t("schedule.filters.funDive"),
        t("schedule.filters.hasSpace"),
        `${t("schedule.filters.canDive")} ${t("course.certificationLevels.openWater")}`,
        t("schedule.filters.hideAboveLevel"),
      ].join(" · "),
    );
  });

  it("prints the whole board with no scope line when nothing narrowed it", () => {
    const { container } = sheet([row("a", "2026-10-31T12:00:00Z")], {
      monthLabel: null,
      lensName: null,
      tripTypeFilter: undefined,
      hasSpaceFilter: false,
      canDiveFilter: undefined,
      hideAboveFilter: false,
    });
    expect(container.querySelector("h1 + p")?.textContent).toContain("All times below");
  });

  it("states the seats, the price, the requirement and the above-level word as words", () => {
    const { container } = sheet([
      row("a", "2026-10-31T12:00:00Z", {
        requirements: ["Advanced Open Water or higher"],
        aboveLevel: "Above your level",
        capacityText: "Full",
      }),
    ]);
    const text = container.textContent ?? "";
    expect(text).toContain("Advanced Open Water or higher · Above your level");
    expect(text).toContain("Full · $95");
  });

  it("carries the shop's number, email and street, and says so when the board is empty", () => {
    const { container } = sheet([]);
    const text = container.textContent ?? "";
    expect(text).toContain(t("schedule.noTrips"));
    expect(text).toContain("+1 305 555 0100 · dock@bluemantis.example");
    expect(text).toContain("100 Ocean Drive, Key Largo, FL 33037");
    expect(text).toContain("/s/blue-mantis");
  });
});
