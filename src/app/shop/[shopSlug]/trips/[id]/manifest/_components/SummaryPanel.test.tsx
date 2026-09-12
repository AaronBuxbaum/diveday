// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";
import { DiverRollCall } from "./DiverRollCall";
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
    notHere: 0,
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

describe("the closed checkpoint (ADR 20260901-diveday-reimagined, slice 13h)", () => {
  it("says it in the heading and the full figure, never in coral", () => {
    // No coral on a manifest or a roll call: the panel used to turn accent
    // when the checkpoint closed. The word and the water at the brim are the
    // whole moment.
    const { container } = renderPanel({
      rollCallComplete: true,
      completeness: completeness({
        reason: null,
        complete: true,
        diversAccountedFor: true,
        crewAccountedFor: true,
      }),
      summary: summary({ notBoarded: 0, notBackAboard: 0, boarded: 3 }),
      notBackAboardDivers: [],
    });
    expect(screen.getByRole("heading", { name: "Roll call complete" })).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe(
      "3 of 3 divers aboard",
    );
    expect(container.innerHTML).not.toMatch(/accent/);
  });

  it("holds the water under the brim while a diver is not back aboard", () => {
    // Eight out, seven back, one recorded missing: every diver has a result,
    // so a glass that filled on "recorded" stood full at the exact moment the
    // page holds its loudest fact (dive-domain review 20260902). The water
    // counts aboard, and the words say what it counts.
    renderPanel({
      summary: summary({
        totalDivers: 8,
        boarded: 7,
        notBoarded: 1,
        notBackAboard: 1,
        awaiting: 0,
      }),
    });
    const figure = screen.getByRole("progressbar");
    expect(figure.getAttribute("aria-valuenow")).toBe("7");
    expect(figure.getAttribute("aria-valuemax")).toBe("8");
    expect(figure.getAttribute("aria-valuetext")).toBe("7 of 8 divers aboard");
    const water = document.querySelector<HTMLElement>("[data-head-count-water]");
    expect(water?.style.transform).toBe("scaleY(0.875)");
  });

  it("measures an after-dive count against who went out, not who bought a seat", () => {
    // One diver never left the dock (ashore, carried forward); the other seven
    // are all back. The glass is full — the roll call has nobody to wait for.
    renderPanel({
      completeness: completeness({ reason: null, complete: true, diversAccountedFor: true }),
      summary: summary({
        totalDivers: 8,
        boarded: 7,
        notBoarded: 1,
        notBackAboard: 0,
        awaiting: 0,
      }),
      notBackAboardDivers: [],
    });
    const figure = screen.getByRole("progressbar");
    expect(figure.getAttribute("aria-valuetext")).toBe("7 of 7 divers aboard");
    const water = document.querySelector<HTMLElement>("[data-head-count-water]");
    expect(water?.style.transform).toBe("scaleY(1)");
  });
});

/**
 * **The line that exists because nothing refuses.**
 *
 * A seat the counter released as a no-show is sellable at once, and boarding
 * the diver who turns up anyway takes the seat back rather than refusing a body
 * the crew is looking at (`reclaimReleasedSeat`, src/db/manifests.ts). The boat
 * can then be carrying one more person than it seats, and this panel is the
 * only place that is said — so it is pinned with the other danger lines, not
 * left to the prose half that scrolls away.
 */
describe("a boat carrying more than it seats says so", () => {
  it("raises the count of divers aboard beyond the seats, and stays quiet within them", () => {
    renderPanel({ summary: summary({ overCapacity: 1 }) });
    const line = screen.getByText(/aboard beyond the seats this boat has/);
    expect(line.textContent).toContain("1 diver is aboard beyond the seats this boat has.");
    // Pinned, never in the half a captain can scroll past.
    expect(line.closest("section")).not.toBeNull();

    cleanup();
    renderPanel({ summary: summary({ overCapacity: 0 }) });
    expect(screen.queryByText(/aboard beyond the seats this boat has/)).toBeNull();
  });
});

/**
 * **The denominator is bodies to expect, not rows on paper** (#1209,
 * `dive-domain-expert` review 20260911).
 *
 * The counter's own figures already leave a released seat out of every count
 * that means people (`isNoShowAtCounter`, src/lib/check-in.ts). The head count
 * at the rail is the same kind of figure and was the one that still asked the
 * crew for a head the shop had been told was not coming.
 */
describe("a seat the counter released is not a head to count", () => {
  it("drops a written-off diver from who the crew are expecting", () => {
    // Eight bought seats, one written off at the desk, six aboard. The crew
    // are looking for seven people, and the one still to come is the seventh.
    renderPanel({
      isDeparture: true,
      checkpoint: "departure",
      completeness: completeness({ reason: "divers_awaiting" }),
      summary: summary({
        totalDivers: 8,
        boarded: 6,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 2,
        notHere: 1,
      }),
      notBackAboardDivers: [],
    });
    const figure = screen.getByRole("progressbar");
    expect(figure.getAttribute("aria-valuemax")).toBe("7");
    expect(figure.getAttribute("aria-valuetext")).toBe("6 of 7 divers aboard");
  });

  it("never subtracts the same diver twice", () => {
    // `notHere` counts only rows with no roll-call result, so a diver the desk
    // released *and* the crew then recorded ashore is in `ashore` alone. If
    // both took a turn at the denominator this would read "7 of 6".
    renderPanel({
      summary: summary({
        totalDivers: 8,
        boarded: 7,
        notBoarded: 1,
        notBackAboard: 0,
        awaiting: 0,
        notHere: 0,
      }),
      notBackAboardDivers: [],
    });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe(
      "7 of 7 divers aboard",
    );
  });
});

/**
 * **Every chip points at a row that is on the page.**
 *
 * The panel's name chips and the roll call's rows are two halves of one jump,
 * rendered from two files, and until `diverRowId` existed each spelled the
 * target itself. They agreed — and nothing here would have noticed if they
 * stopped: the chip test above asserts `"#diver-row-b-3"` and the roll call's
 * asserts `diver-row-b-1..b-3`, each restating its own literal, so renaming
 * one side and missing the other keeps both suites green while a captain taps
 * a name at the rail and the page does not move.
 *
 * That is not hypothetical. It is #1675, shipped on the offline manifest,
 * where the face grid jumped to `diver-row-<bookingId>` and its rows carried
 * `offline-roll-call-<bookingId>`.
 *
 * So this renders both from one roster and resolves the hrefs against the
 * document. It asserts a relationship rather than a string, which is the only
 * shape that can fail on a rename.
 */
describe("the panel's chips and the roll call's rows are one jump", () => {
  function diver(bookingId: string, fullName: string): TripManifest["divers"][number] {
    return {
      bookingId,
      fullName,
      email: null,
      emergencyContactName: "Asha Iyer",
      emergencyContactPhone: "+1-305-555-0231",
      readiness: { status: "ready", blockers: [] },
      rentalFit: { state: "own_kit" },
      nitroxRequested: false,
      checkedIn: false,
      buddyTeam: null,
      buddyAlert: null,
      rollCall: undefined,
    } as TripManifest["divers"][number];
  }

  it("resolves every name chip to a diver row in the same document", () => {
    const roster = [
      diver("b-1", "Ana Ruiz"),
      diver("b-2", "Diego Marín"),
      diver("b-3", "Priya Sharma"),
    ];
    const { container } = render(
      <>
        <SummaryPanel
          checkpoint="after_dive_1"
          isDeparture={false}
          rollCallComplete={false}
          completeness={completeness()}
          summary={summary()}
          separatedTeams={0}
          // Both chip lists, because both built the target by hand: the
          // still-to-call list and the not-back-aboard list.
          uncalled={[{ bookingId: "b-2", fullName: "Diego Marín", blocked: false }]}
          uncalledCrew={[]}
          notBackAboardDivers={[{ bookingId: "b-3", fullName: "Priya Sharma" }]}
          notBackAboardCrew={[]}
          t={t}
        />
        <DiverRollCall
          divers={roster}
          crewNames={[]}
          checkpoint="after_dive_1"
          isDeparture={false}
          shopSlug="blue-mantis"
          tripId="00000000-0000-4000-8000-0000000000ff"
          locale="en-US"
          timezone="America/New_York"
          notesByBooking={new Map()}
          rollCallAction={vi.fn(async () => ({ ok: true }) as const)}
          addPrivateNoteAction={vi.fn(async () => undefined) as never}
          rollCallButtonCopy={() => ({
            errorRefusal: "Try again",
            blockedMessage: "Still blocked",
          })}
          buddyTeamLabel={() => null}
          t={t}
        />
      </>,
    );

    const chips = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="#diver-row-"]')];
    // A vacuous pass is the failure mode worth naming: if the panel stopped
    // rendering chips this would assert nothing at all.
    expect(chips.length).toBe(2);
    for (const chip of chips) {
      const id = chip.getAttribute("href")?.slice(1) ?? "";
      expect(
        container.querySelector(`li[id="${id}"]`),
        `no row for ${chip.textContent}`,
      ).not.toBeNull();
    }
  });
});
