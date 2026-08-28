// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";
import { SummaryPanel } from "./SummaryPanel";

/**
 * **The count panel names the people it is counting** (dive-domain review
 * 20260828).
 *
 * The two danger lines used to carry counts alone — "1 diver is not back
 * aboard", "1 crew member is not back aboard" — and the only thing that
 * pointed at a person was `order-first` on the diver's row. That is paint
 * order: it moves nothing in the DOM, tab or screen-reader order, and it
 * cannot reach the crew list at all, which sits below the entire diver roster.
 * On the half of the boat most reliably in the water, the app's own words for
 * "a divemaster is still down" were a number that named nobody.
 *
 * So the chips are the load-bearing mechanism and the ordering is the nicety
 * on top. What is pinned here is that both halves are named, that each name is
 * a link to that person's own row, and that none of it waits for roll call to
 * be "started" — a stated "did not come back" has to be reachable at any
 * moment.
 *
 * Deliberately not a screenshot: the layout is free to move, the reachability
 * is not.
 */

afterEach(cleanup);

const t = staffTranslator("en-US");

function summary(overrides: Partial<TripManifest["summary"]> = {}): TripManifest["summary"] {
  return {
    totalDivers: 3,
    ready: 3,
    blocked: 0,
    boarded: 2,
    notBoarded: 1,
    notBackAboard: 1,
    awaiting: 0,
    ...overrides,
  } as TripManifest["summary"];
}

function completeness(
  overrides: Partial<TripManifest["completeness"]> = {},
): TripManifest["completeness"] {
  return {
    complete: false,
    diversAccountedFor: false,
    crewAccountedFor: false,
    reason: "divers_not_back_aboard",
    crewReason: null,
    crewCounts: { crewAssigned: 2, crewAwaiting: 0, crewNotBackAboard: 0, crewAshore: 0 },
    ...overrides,
  } as TripManifest["completeness"];
}

function renderPanel(overrides: Partial<Parameters<typeof SummaryPanel>[0]> = {}) {
  return render(
    <SummaryPanel
      checkpoint="after_dive_1"
      isDeparture={false}
      rollCallComplete={false}
      completeness={completeness()}
      summary={summary()}
      separatedTeams={0}
      uncalled={[]}
      uncalledCrew={[]}
      notBackAboardDivers={[{ bookingId: "b-3", fullName: "Priya Sharma" }]}
      notBackAboardCrew={[]}
      t={t}
      {...overrides}
    />,
  );
}

describe("the missing are named, not just counted", () => {
  it("links each not-back-aboard diver to their own row", () => {
    renderPanel();
    const list = screen.getByRole("list", { name: "Who is not back aboard" });
    const link = within(list).getByRole("link", { name: "Priya Sharma" });
    expect(link.getAttribute("href")).toBe("#diver-row-b-3");
  });

  it("names a not-back-aboard crew member, whose row is below the whole roster", () => {
    // The finding that earned this test: crew reached the panel as a count
    // only, and `order-first` on the diver list can never surface them.
    renderPanel({
      completeness: completeness({ reason: null, crewReason: "crew_not_back_aboard" }),
      summary: summary({ notBoarded: 0, notBackAboard: 0, boarded: 3 }),
      notBackAboardDivers: [],
      notBackAboardCrew: [{ id: "p-9", fullName: "Keiko Tanaka" }],
    });
    const list = screen.getByRole("list", { name: "Who is not back aboard" });
    const link = within(list).getByRole("link", { name: "Keiko Tanaka (crew)" });
    expect(link.getAttribute("href")).toBe("#crew-row-p-9");
  });

  it("names both halves in one list, divers first", () => {
    // One list, for the same reason the still-to-call chips merge the halves:
    // at the rail the question is "who is still in the water?", and the answer
    // must not be split by whether the person holds a booking.
    renderPanel({
      completeness: completeness({ crewReason: "crew_not_back_aboard" }),
      notBackAboardCrew: [{ id: "p-9", fullName: "Keiko Tanaka" }],
    });
    const list = screen.getByRole("list", { name: "Who is not back aboard" });
    expect(
      within(list)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Priya Sharma", "Keiko Tanaka (crew)"]);
  });

  it("says nothing when everybody is accounted for", () => {
    renderPanel({
      completeness: completeness({ reason: null, complete: true, diversAccountedFor: true }),
      summary: summary({ notBoarded: 0, notBackAboard: 0, boarded: 3 }),
      notBackAboardDivers: [],
    });
    expect(screen.queryByRole("list", { name: "Who is not back aboard" })).toBeNull();
  });

  it("names the missing before the first result of the checkpoint lands", () => {
    // The still-to-call chips hold off until roll call has started, so they do
    // not restate the whole roster. This list must not inherit that gate: the
    // one row it names is a person in the water.
    renderPanel({ summary: summary({ boarded: 0, awaiting: 2 }) });
    expect(screen.getByRole("list", { name: "Who is not back aboard" })).toBeTruthy();
  });
});
