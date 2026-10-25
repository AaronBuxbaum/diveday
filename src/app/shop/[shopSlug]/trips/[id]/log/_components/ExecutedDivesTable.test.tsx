// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { ExecutedDivesTable, surfaceIntervalText, waterTimes } from "./ExecutedDivesTable";

/**
 * The departure log's dive rows, on the document a shop hands an insurer
 * (fourth review, item 17): no "Not recorded" where nothing could be, and a
 * same-day dive as one date and a time range.
 */

afterEach(cleanup);

const t = staffTranslator("en-US");
const ZONE = "America/New_York";
const MISSING = "Times not recorded";

describe("waterTimes", () => {
  it("says a same-day dive's date once, then the range", () => {
    const text = waterTimes(
      { enteredAt: "2026-10-14T09:50:00.000Z", exitedAt: "2026-10-14T10:30:00.000Z" },
      "en-US",
      ZONE,
      MISSING,
    );
    expect(text).toMatch(/^Wed,\sOct\s14 · 5:50\sAM – 6:30\sAM\sEDT$/);
  });

  it("keeps both dates on a dive that crosses the shop's midnight", () => {
    const text = waterTimes(
      { enteredAt: "2026-10-15T03:40:00.000Z", exitedAt: "2026-10-15T04:20:00.000Z" },
      "en-US",
      ZONE,
      MISSING,
    );
    expect(text).toMatch(/Oct\s14.*11:40\sPM.*–.*Oct\s15.*12:20\sAM/);
  });

  it("says a missing time in words", () => {
    expect(
      waterTimes({ enteredAt: "2026-10-14T09:50:00.000Z", exitedAt: null }, "en-US", ZONE, MISSING),
    ).toMatch(/– Times not recorded$/);
  });
});

describe("surfaceIntervalText", () => {
  it("calls dive 1 the first dive, never a missing interval", () => {
    expect(surfaceIntervalText({ diveNumber: 1, surfaceIntervalMinutes: null }, t)).toBe(
      "First dive",
    );
  });

  it("still says a later dive's interval was not recorded", () => {
    expect(surfaceIntervalText({ diveNumber: 2, surfaceIntervalMinutes: null }, t)).toBe(
      "Not recorded",
    );
    expect(surfaceIntervalText({ diveNumber: 2, surfaceIntervalMinutes: 40 }, t)).toBe("40 min");
  });
});

describe("ExecutedDivesTable", () => {
  it("prints one row per dive with the words above", () => {
    const { container } = render(
      <ExecutedDivesTable
        dives={[
          {
            diveNumber: 1,
            actualSiteName: "Molasses Reef",
            enteredAt: "2026-10-14T09:50:00.000Z",
            exitedAt: "2026-10-14T10:30:00.000Z",
            maxDepthMeters: 14,
            observedConditions: null,
            notRecorded: [],
            recordedByName: "Sal Moretti",
            surfaceIntervalMinutes: null,
          },
        ]}
        locale="en-US"
        timeZone={ZONE}
        t={t}
      />,
    );
    const row = container.querySelector("tbody tr");
    expect(row?.textContent).toContain("First dive");
    expect(row?.textContent).not.toContain("Not recorded First dive");
    expect(row?.textContent?.match(/Oct\s14/g)).toHaveLength(1);
  });

  it("says every field as a labeled card below md, and keeps the table for md and paper", () => {
    const { container } = render(
      <ExecutedDivesTable
        dives={[
          {
            diveNumber: 2,
            actualSiteName: "French Reef",
            enteredAt: "2026-10-14T11:20:00.000Z",
            exitedAt: "2026-10-14T12:05:00.000Z",
            maxDepthMeters: null,
            observedConditions: null,
            notRecorded: [],
            recordedByName: null,
            surfaceIntervalMinutes: 50,
          },
        ]}
        locale="en-US"
        timeZone={ZONE}
        t={t}
      />,
    );
    const card = container.querySelector("[data-dive-cards] li");
    expect(card?.className).not.toContain("print:block");
    expect(container.querySelector("[data-dive-cards]")?.className).toContain("md:hidden");
    const labels = [...(card?.querySelectorAll("dt") ?? [])].map((dt) => dt.textContent);
    expect(labels).toEqual([
      "Actual site",
      "Water times",
      "Maximum depth",
      "Observed conditions",
      "Surface interval",
      "Recorded by",
    ]);
    // An absent fact is said, never dropped, in the card as in the table.
    expect(card?.textContent).toContain("Maximum depthNot recorded");
    expect(card?.textContent).toContain("Recorded byNot on file");
    expect(container.querySelector("tbody tr")?.textContent).toContain("50 min");
  });
});
