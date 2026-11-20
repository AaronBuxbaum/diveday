// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckFlow } from "@/components/offline-manifest/DeckFlow";
import { deckCopy } from "@/components/offline-manifest/deck-copy";
import { staffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";
import { DiverRollCall } from "./DiverRollCall";
import { rollCallScrollMargin } from "./RollCallControls";
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
    overCapacity: 0,
    overBoatCapacity: 0,
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
      notBackAboardDivers={[{ bookingId: "b-3", fullName: "Priya Sharma" }]}
      notBackAboardCrew={[]}
      t={t}
      {...overrides}
    />,
  );
}

describe("the missing are named, not just counted", () => {
  it("calls out when an awaiting person needs a recount", () => {
    renderPanel({
      summary: summary({ boarded: 1, notBoarded: 1, awaiting: 1, recountRequired: 1 }),
    });
    expect(screen.getByText("1 person needs a recount")).toBeInTheDocument();
  });
  it("names each not-back-aboard diver", () => {
    renderPanel();
    const list = screen.getByRole("list", { name: "Who is not back aboard" });
    expect(within(list).getByText("Priya Sharma")).toBeInTheDocument();
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
    expect(within(list).getByText("Keiko Tanaka (crew)")).toBeInTheDocument();
  });

  it("names both halves in one list, divers first", () => {
    // One list: at the rail the question is "who is still in the water?", and the answer
    // must not be split by whether the person holds a booking.
    renderPanel({
      completeness: completeness({ crewReason: "crew_not_back_aboard" }),
      notBackAboardCrew: [{ id: "p-9", fullName: "Keiko Tanaka" }],
    });
    const list = screen.getByRole("list", { name: "Who is not back aboard" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
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
    // The count row holds off until roll call has started. This list must not
    // inherit that gate: the one row it names is a person in the water.
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
 * the passenger who turns up anyway takes the seat back rather than refusing a
 * body the crew is looking at (`reclaimReleasedSeat`, src/db/manifests.ts).
 * Both the passenger and total-occupant limits are warnings, and both stay
 * pinned with the other danger lines.
 */
describe("manifest capacity warnings", () => {
  it("raises the count beyond the trip capacity, and stays quiet within it", () => {
    renderPanel({ summary: summary({ overCapacity: 1 }) });
    const line = screen.getByText(/aboard beyond the passenger capacity set for this trip/);
    expect(line.textContent).toContain("This warning does not block boarding.");
    // Pinned, never in the half a captain can scroll past.
    expect(line.closest("section")).not.toBeNull();

    cleanup();
    renderPanel({ summary: summary({ overCapacity: 0 }) });
    expect(screen.queryByText(/aboard beyond the passenger capacity set for this trip/)).toBeNull();
  });

  it("says separately when passengers and crew exceed the assigned boat's capacity", () => {
    renderPanel({ summary: summary({ overBoatCapacity: 2 }) });
    expect(
      screen.getByText(/aboard beyond the total capacity set for this boat, crew included/)
        .textContent,
    ).toContain("This warning does not block boarding.");
  });
});

/**
 * Batch 6, item 2: more passengers aboard than the certificate allows. This
 * remains independent of both configured-capacity warnings.
 */
describe("a boat carrying more than its certificate allows says so on the count", () => {
  it("names the limit beside the count and keeps the separate capacity warning", () => {
    renderPanel({
      summary: summary({ boarded: 13, overCapacity: 1, overBoatCapacity: 2 }),
      overCertificate: { aboard: 13, limit: 12 },
    });
    const line = screen.getByText("Certificate allows 12 passengers");
    expect(line.closest("section")).not.toBeNull();
    expect(screen.getByRole("progressbar")).toHaveClass("border-danger");
    expect(
      screen.getByText(/aboard beyond the passenger capacity set for this trip/),
    ).toBeVisible();
    expect(
      screen.getByText(/aboard beyond the total capacity set for this boat, crew included/),
    ).toBeVisible();
  });

  it("says nothing about the certificate within it", () => {
    renderPanel({ overCertificate: null });
    expect(screen.queryByText(/Certificate allows/)).toBeNull();
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

describe("the card and the rows it pins over", () => {
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

  /**
   * **And the jump lands below the card, however tall the card grows**
   * (pixel-craft class 9). The card publishes its measured height on the
   * column it pins in, the same column the rows sit in, and every row's
   * scroll margin reads it. Asserted as that relationship, because jsdom has
   * no layout: the stubbed observer stands in for the phone's 426px card.
   */
  it("hands the rows the card's measured height, on the column they share", () => {
    const observed: Array<(entries: Array<Partial<ResizeObserverEntry>>) => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: Array<Partial<ResizeObserverEntry>>) => void) {
          observed.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      const { container } = render(
        <div data-testid="column">
          <SummaryPanel
            checkpoint="after_dive_1"
            isDeparture={false}
            rollCallComplete={false}
            completeness={completeness()}
            summary={summary()}
            separatedTeams={0}
            notBackAboardDivers={[{ bookingId: "b-3", fullName: "Priya Sharma" }]}
            notBackAboardCrew={[]}
            t={t}
          />
          <DiverRollCall
            context={{
              divers: [diver("b-1", "Ana Ruiz"), diver("b-3", "Priya Sharma")],
              crew: [],
              checkpoint: "after_dive_1",
              isDeparture: false,
              shopSlug: "blue-mantis",
              tripId: "00000000-0000-4000-8000-0000000000ff",
              locale: "en-US",
              timezone: "America/New_York",
              notesByBooking: new Map(),
              rollCallAction: vi.fn(async () => ({ ok: true }) as const),
              addPrivateNoteAction: vi.fn(async () => undefined) as never,
              rollCallButtonCopy: () => ({
                errorRefusal: "Try again",
                blockedMessage: "Still blocked",
              }),
              buddyTeamLabel: () => null,
              t,
            }}
          />
        </div>,
      );
      const column = screen.getByTestId("column");
      const card = screen.getByRole("region", { name: "After dive 1" });
      // Still the column's own child: a wrapper would un-pin the card (see
      // `SummaryPanel`), and it would publish the height where no row reads it.
      expect(card.parentElement).toBe(column);
      expect(card).toHaveClass("sticky", "top-(--chrome-h)");

      expect(observed).toHaveLength(1);
      observed[0]?.([{ target: card, borderBoxSize: [{ blockSize: 425.4, inlineSize: 350 }] }]);
      expect(column.style.getPropertyValue("--roll-call-panel-h")).toBe("426px");
      const rows = [...container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")];
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toHaveClass(...rollCallScrollMargin(false).split(" "));
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("uncalled crew while divers are still open", () => {
  it("names the crew count even though the diver gap ranks first", () => {
    renderPanel({
      isDeparture: true,
      checkpoint: "departure",
      completeness: completeness({
        reason: "divers_awaiting",
        crewReason: "crew_awaiting",
        crewCounts: { crewAssigned: 2, crewAwaiting: 1, crewNotBackAboard: 0, crewAshore: 0 },
      }),
      summary: summary({
        totalDivers: 3,
        boarded: 1,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 2,
      }),
      notBackAboardDivers: [],
    });
    expect(screen.getByText(/1 crew member still to call/)).toBeInTheDocument();
  });

  it("stays quiet about crew when every crew member has a result", () => {
    renderPanel({
      isDeparture: true,
      checkpoint: "departure",
      completeness: completeness({ reason: "divers_awaiting", crewReason: null }),
      summary: summary({
        totalDivers: 3,
        boarded: 1,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 2,
      }),
      notBackAboardDivers: [],
    });
    expect(screen.queryByText(/still to call/)).toBeNull();
  });
});

/**
 * **The prose under the pinned card starts on the card's content edge** (K-554).
 *
 * The card is `border p-4`, so its chips start 17px in; the prose block under
 * it was `px-4`, and its lines started a pixel left of the card's. The live
 * status line stays mounted: it must exist before its words arrive.
 */
describe("who the people are", () => {
  it("leaves out a type nobody is, as the offline copy does", () => {
    // Regression (dive-domain review, PR #2224): the live panel printed
    // "0 riders" where the offline copy left the type out.
    renderPanel({
      summary: summary({ totalDivers: 4, byType: { diver: 3, snorkeler: 1, rider: 0 } }),
    });
    expect(screen.getByText("3 divers · 1 snorkeler")).toBeInTheDocument();
    expect(screen.queryByText(/rider/)).toBeNull();
  });

  it("counts the blocked aboard as people, since a snorkeler or rider can be one", () => {
    // Regression (visual triage, PR #2224): a mixed boat's Boat tab called a
    // snorkeler and a rider among its blocked "divers".
    renderPanel({
      isDeparture: true,
      checkpoint: "departure",
      completeness: completeness({ reason: null, complete: true }),
      summary: summary({
        totalDivers: 7,
        byType: { diver: 5, snorkeler: 1, rider: 1 },
        ready: 3,
        blocked: 4,
        boarded: 5,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 2,
      }),
      blockedAtDock: { undecided: 2, aboard: 2 },
      notBackAboardDivers: [],
    });
    expect(screen.getByText("2 blocked people aboard")).toBeInTheDocument();
    expect(screen.queryByText(/blocked divers/)).toBeNull();
  });
});

describe("the prose under the pinned card", () => {
  function renderAwaiting() {
    return renderPanel({
      isDeparture: true,
      checkpoint: "departure",
      completeness: completeness({ reason: "divers_awaiting" }),
      summary: summary({
        totalDivers: 3,
        ready: 2,
        blocked: 1,
        boarded: 1,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 2,
      }),
      notBackAboardDivers: [],
    });
  }

  it("says what is still open inside the pinned card, under the head count (B53)", () => {
    renderAwaiting();
    const live = document.querySelector('[aria-live="polite"]');
    const card = document.querySelector("section.sticky");
    expect(card).not.toBeNull();
    expect(card?.contains(live)).toBe(true);
    // The same column as the count's own rows, after them.
    expect(live?.parentElement?.querySelector("p")?.textContent).toMatch(/aboard/);
  });

  it("keeps the live line mounted while it is empty", () => {
    renderAwaiting();
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.tagName).toBe("P");
    expect(live).toBeEmptyDOMElement();
  });
});

/**
 * **The headline never reassures over a blocked row** (UX audit 2026-10-07,
 * item 16). "8 of 8 divers aboard" stood over three rows reading Blocked, and
 * the count of them was a sentence in the half that scrolls away. The panel
 * says the summary's two settled-out figures, never `blocked` itself: a
 * blocked diver left ashore or released by the desk is outside the total, and
 * counting them read "5 of 5 aboard, 3 blocked" (dive-domain review).
 */
describe("blocked divers at the head count", () => {
  function renderBlocked(
    isDeparture: boolean,
    counts: { blocked: number; undecided: number; aboard: number },
  ) {
    return renderPanel({
      isDeparture,
      checkpoint: isDeparture ? "departure" : "after_dive_1",
      completeness: completeness({ reason: null, complete: true }),
      summary: summary({
        totalDivers: 8,
        ready: 8 - counts.blocked,
        blocked: counts.blocked,
        boarded: 5,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 3,
      }),
      blockedAtDock: { undecided: counts.undecided, aboard: counts.aboard },
      notBackAboardDivers: [],
    });
  }

  it("carries the undecided blocked count in the pinned card, beside the count it qualifies", () => {
    renderBlocked(true, { blocked: 3, undecided: 3, aboard: 0 });
    const line = screen.getByText("3 blocked");
    expect(line).toHaveClass("text-danger");
    // In the sticky card, not the prose that scrolls away under it.
    expect(line.closest(".sticky")).not.toBeNull();
    expect(screen.queryByText(/divers are blocked/)).toBeNull();
  });

  it("never says the roster's blocked figure, only the dock's", () => {
    // Three blocked on the roster, all left ashore or released as not here:
    // none undecided, none aboard. Nothing to say over the count.
    renderBlocked(true, { blocked: 3, undecided: 0, aboard: 0 });
    expect(screen.queryByText(/blocked/)).toBeNull();
  });

  it("says a blocked diver the crew marked aboard, apart from the undecided", () => {
    renderBlocked(true, { blocked: 3, undecided: 1, aboard: 2 });
    expect(screen.getByText("2 blocked people aboard")).toHaveClass("text-danger");
    expect(screen.getByText("1 blocked")).toBeInTheDocument();
  });

  it("says nothing about blocked after a dive, where it gates nothing", () => {
    renderBlocked(false, { blocked: 3, undecided: 1, aboard: 2 });
    expect(screen.queryByText(/blocked/)).toBeNull();
  });
});

/**
 * **A missing person's name opens that person** on the roll call screen.
 * The chips used to be links to `#diver-row-…` and `#crew-row-…`, rows the
 * one-person roll call never draws, so a captain tapping a red name at the
 * rail went nowhere. Inside the roll call each chip opens that person, with
 * their exception sheet open; diver and crew alike.
 */
describe("a missing person's chip opens them on the roll call", () => {
  function deckWithPanel() {
    const people = [
      { id: "b-1", name: "Ana Ruiz", role: "Guest" },
      { id: "b-3", name: "Priya Sharma", role: "Guest" },
      { id: "p-9", name: "Keiko Tanaka", role: "Crew" },
    ].map((person) => ({
      ...person,
      outstanding: person.id !== "b-1",
      attention: person.id !== "b-1",
      record: <p>record {person.name}</p>,
      details: <p>details of {person.name}</p>,
    }));
    render(
      <DeckFlow
        people={people}
        copy={deckCopy(t)}
        checkpoint="After dive 1"
        progress="1 of 3"
        complete={false}
        timeZone="America/New_York"
        locale="en-US"
        attention={
          <SummaryPanel
            checkpoint="after_dive_1"
            isDeparture={false}
            rollCallComplete={false}
            completeness={completeness({ crewReason: "crew_not_back_aboard" })}
            summary={summary()}
            separatedTeams={0}
            notBackAboardDivers={[{ bookingId: "b-3", fullName: "Priya Sharma" }]}
            notBackAboardCrew={[{ id: "p-9", fullName: "Keiko Tanaka" }]}
            t={t}
          />
        }
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: deckCopy(t).review })[0]);
    return screen.getByRole("list", { name: "Who is not back aboard" });
  }

  it("opens the diver, with their sheet open", () => {
    const list = deckWithPanel();
    fireEvent.click(within(list).getByRole("button", { name: "Priya Sharma" }));
    expect(screen.getByRole("heading", { name: "Priya Sharma" })).toBeInTheDocument();
    expect(screen.getByText("details of Priya Sharma")).toBeInTheDocument();
  });

  it("opens the crew member, whose name carries (crew)", () => {
    const list = deckWithPanel();
    fireEvent.click(within(list).getByRole("button", { name: "Keiko Tanaka (crew)" }));
    expect(screen.getByRole("heading", { name: "Keiko Tanaka" })).toBeInTheDocument();
    expect(screen.getByText("details of Keiko Tanaka")).toBeInTheDocument();
  });

  it("points at no row that is not on the screen", () => {
    deckWithPanel();
    expect(document.querySelectorAll('a[href^="#diver-row-"], a[href^="#crew-row-"]')).toHaveLength(
      0,
    );
  });
});
