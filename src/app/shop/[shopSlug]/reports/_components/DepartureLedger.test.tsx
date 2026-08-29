// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DepartureLedger, type DepartureRow } from "./DepartureLedger";

afterEach(cleanup);

/**
 * Slice 9f of ADR 20260827-the-shops-shelves, and issue 775's rule carried
 * through the recomposition intact: **the ink is on the gap, not the
 * achievement.** The waiver meter's *remainder* is the only thing that may
 * carry a tone; the fill is quiet at every ratio, in every row.
 *
 * That is worth pinning rather than eyeballing because the regression is
 * plausible and looks like an improvement: colouring the fill makes a healthy
 * row the loudest thing in the column and leaves the row that needs a staffer
 * as the faintest, which is exactly the state the report was found in.
 */

const FULL: DepartureRow = {
  tripId: "trip-full",
  href: "/shop/blue-mantis/trips/trip-full",
  title: "Two-Tank Reef — Molasses & French",
  date: "Wed, Aug 26",
  seats: { fact: "12 of 12 seats", ratio: 1 },
  crew: "3 crew",
  waivers: { fact: "12 of 12 waivers", ratio: 1 },
};

const SHORT: DepartureRow = {
  tripId: "trip-short",
  href: "/shop/blue-mantis/trips/trip-short",
  title: "Two-Tank Reef — Benwood & Elbow",
  date: "Mon, Aug 24",
  seats: { fact: "9 of 12 seats", ratio: 0.75 },
  crew: "2 crew",
  waivers: { fact: "7 of 9 waivers", ratio: 7 / 9 },
};

const UNBOOKED: DepartureRow = {
  tripId: "trip-empty",
  href: "/shop/blue-mantis/trips/trip-empty",
  title: "Wreck Trip — Duane",
  date: "Sun, Aug 23",
  seats: { fact: "0 of 8 seats", ratio: 0 },
  crew: "0 crew",
  waivers: null,
};

function renderLedger(rows: DepartureRow[] = [FULL, SHORT, UNBOOKED]) {
  return render(
    <DepartureLedger
      label="Trips this month"
      labelId="reports-departures"
      count="24 trips"
      rows={rows}
    />,
  );
}

/** The element the fact's words sit in, which is also the meter's own wrapper. */
function share(fact: string) {
  const words = screen.getByText(fact);
  const meter = words.querySelector("div");
  return { words, meter };
}

describe("the waiver meter", () => {
  it("puts the tone on the remainder, never on the fill", () => {
    renderLedger();
    const { words, meter } = share("7 of 9 waivers");
    // The track is what the fill has not covered — that is the warning.
    expect(meter?.className).toContain("bg-warning");
    // …and the fill itself stays quiet, at this ratio and every other.
    for (const layer of meter?.querySelectorAll("div") ?? []) {
      expect(layer.className).toContain("bg-muted");
      expect(layer.className).not.toContain("bg-warning");
    }
    // Colour never carries it alone: the count is right there in words.
    expect(words.className).toContain("text-warning-strong");
  });

  it("says nothing at all once every waiver is in", () => {
    renderLedger();
    const { words, meter } = share("12 of 12 waivers");
    expect(meter?.className).not.toContain("bg-warning");
    expect(words.className).not.toContain("text-warning-strong");
  });

  it("leaves the seats meter quiet however empty the boat", () => {
    // An empty boat on a month being reviewed is a fact, not a task — toning
    // one would put amber on most rows of a working shop's report.
    renderLedger();
    for (const fact of ["12 of 12 seats", "9 of 12 seats", "0 of 8 seats"]) {
      expect(share(fact).meter?.className).not.toContain("bg-warning");
    }
  });

  it("reports no waivers for a departure nobody booked", () => {
    // Rather than an em dash against a bar of zero: there is nothing to
    // collect, so there is nothing to say.
    renderLedger([UNBOOKED]);
    expect(screen.queryByText(/waivers/)).toBeNull();
  });
});

describe("the row", () => {
  it("carries its own nouns, because no column header names them", () => {
    renderLedger();
    // `getAllByText` because a fact matches its own element and every ancestor
    // that contains it; what is asserted is that the words are on the row at
    // all, since a ledger has no header row to borrow a noun from.
    for (const fact of ["9 of 12 seats", "2 crew", "7 of 9 waivers", "Mon, Aug 24"]) {
      expect(screen.getAllByText(fact, { exact: false }).length).toBeGreaterThan(0);
    }
  });

  it("is the door to its own guest list", () => {
    renderLedger([SHORT]);
    const door = screen.getByRole("link", { name: SHORT.title });
    expect(door.getAttribute("href")).toBe(SHORT.href);
  });

  it("hands the month's count to the group header, not to the rows", () => {
    renderLedger();
    expect(screen.getByText("24 trips")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Trips this month" })).toBeTruthy();
  });

  it("draws the meters for the eye only — every number is already in words", () => {
    const { container } = renderLedger();
    for (const meter of container.querySelectorAll(".rounded-full")) {
      expect(meter.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
