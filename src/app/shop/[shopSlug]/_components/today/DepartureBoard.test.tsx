// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DepartureSummary } from "@/db/today";
import { DepartureBoard, type DepartureBoardCopy } from "./DepartureBoard";

afterEach(() => {
  cleanup();
});

const COPY: DepartureBoardCopy = {
  crewingBadge: "You’re crewing",
  courseSession: "Course session · {title}",
  bookedOfCapacityOne: "{booked} of {capacity} booked",
  bookedOfCapacityOther: "{booked} of {capacity} booked",
  boarding: "Board divers",
  openGuests: "Open guests",
  assignCrewMemberAria: "Assign crew member to {title}",
  assignCrewOption: "Assign crew…",
  assignCrewLabel: "Assign crew",
  assignFailed: "That didn’t save — recheck your connection or try again.",
  unassignAria: "Unassign {name}",
  noCrewAssigned: "No crew assigned yet.",
  crewLine: "Crew · {names}",
  editCrew: "Edit",
  boardingSummary: "{aboard} · {ready} · {blocked} · {open}",
  boardingAboardOne: "{count} aboard",
  boardingAboardOther: "{count} aboard",
  boardingReadyOne: "{count} clear to board",
  boardingReadyOther: "{count} clear to board",
  boardingBlockedOne: "{count} blocked",
  boardingBlockedOther: "{count} blocked",
  boardingOpenOne: "{count} seat open",
  boardingOpenOther: "{count} seats open",
  aboardReasonMedical: "a medical hold. A doctor has to sign off, so nobody aboard can clear it.",
  aboardReasonUnknown:
    "nothing on file that clears them. An unsigned waiver is no medical declaration.",
  aboardReasonCertification: "a certification this dive asks for that we have not seen.",
  aboardReasonPayment: "payment still owed. It is in the list below.",
  blockedWarningNamed: "{name} cannot board yet — the fix is in the list below.",
  blockedWarningOne: "{count} diver cannot board yet — they are in the list below.",
  blockedWarningOther: "{count} divers cannot board yet — they are in the list below.",
  blockedAboardNamed: "{name} is aboard — {reason}",
  blockedAboardOne: "{count} diver is aboard — {reason}",
  blockedAboardOther: "{count} divers are aboard — {reason}",
  noneBooked: "No one’s booked yet — share the trip page and they’ll show up here.",
  everyoneAboard: "Everyone’s aboard.",
  crewRollCallOpen: "Every diver is aboard — the crew roll call is still open.",
  clearToBoard: "Everyone booked on this trip is clear to board.",
  sailingToday: "Sailing today",
};

const availableStaff = [
  { id: "staff-1", fullName: "Keiko Tanaka", roles: ["divemaster"] },
  { id: "staff-2", fullName: "Sal Moretti", roles: ["captain"] },
];

function departure(overrides: Partial<DepartureSummary> = {}): DepartureSummary {
  // `blockedAshore` defaults to *all* the blocked divers, which is what "nobody
  // has boarded yet" means and what every case written before roll call entered
  // this component assumed. A case about the boat mid-count sets the split
  // explicitly.
  const blocked = overrides.blocked ?? 1;
  const blockedAboard = overrides.blockedAboard ?? 0;
  return {
    tripId: "trip-1",
    title: "Morning Reef Dive",
    startsAt: new Date("2026-07-28T09:00:00Z"),
    endsAt: new Date("2026-07-28T12:00:00Z"),
    booked: 4,
    capacity: 10,
    ready: 3,
    blocked,
    blockedAboardGroups: [],
    blockedAshoreNames: [],
    boarded: 0,
    blockedAboard,
    blockedAshore: Math.max(0, blocked - blockedAboard),
    courseTitle: null,
    crew: [{ id: "staff-1", fullName: "Keiko Tanaka", roles: ["divemaster"] }],
    // The crew half accounted for, so a case that is not about crew reads the
    // same as it did before the card learned to ask (issue #789). A case that
    // *is* about crew sets this and `crewReason` explicitly.
    crewAccountedFor: true,
    crewReason: null,
    ...overrides,
  };
}

function renderBoard(
  departures: DepartureSummary[],
  updateCrewAction: (
    tripId: string,
    change: { personId: string; operation: "assign" | "unassign" },
  ) => Promise<{ ok: boolean }> = vi.fn().mockResolvedValue({ ok: true }),
) {
  return render(
    <DepartureBoard
      departures={departures}
      shopSlug="blue-mantis"
      timeZone="America/New_York"
      locale="en-US"
      availableStaff={availableStaff}
      updateCrewAction={updateCrewAction}
      copy={COPY}
    />,
  );
}

/**
 * **The count line inflects every one of its four counts.**
 *
 * It used to be one template with four hard-coded plural nouns, so a boat with
 * one diver in each state rendered "1 seats open" in English and, in Spanish,
 * "1 listos para embarcar · 1 bloqueados · 1 plazas libres" — three errors on
 * one line, because Spanish inflects the adjective too (issue #778). No test
 * had ever rendered this card at a count of one, and the seeded demo shop
 * never produces one, so nothing failed and no screenshot showed it.
 */
describe("DepartureBoard boarding counts", () => {
  it("uses the singular for a count of one and the plural otherwise", () => {
    const { unmount } = renderBoard([
      departure({ boarded: 1, ready: 1, blocked: 1, booked: 9, capacity: 10 }),
    ]);
    // One free seat: 10 capacity − 9 booked. The English pairs only differ on
    // this one, which is the point — the other three exist so Spanish can.
    expect(
      screen.getByText("1 aboard · 1 clear to board · 1 blocked · 1 seat open"),
    ).toBeInTheDocument();
    unmount();

    renderBoard([departure({ boarded: 2, ready: 2, blocked: 2, booked: 6, capacity: 10 })]);
    expect(
      screen.getByText("2 aboard · 2 clear to board · 2 blocked · 4 seats open"),
    ).toBeInTheDocument();
  });

  it("says zero seats open on a full boat, not one", () => {
    // `other` is the form for 0 in both locales — the boundary the old
    // hard-coded plural got right by accident and a `count === 1` check would
    // also get right, but which `pluralForm` gets right by asking Intl.
    renderBoard([departure({ boarded: 0, ready: 10, blocked: 0, booked: 10, capacity: 10 })]);
    expect(screen.getByText(/0 seats open$/)).toBeInTheDocument();
  });
});

describe("DepartureBoard readiness caption (one bar, one caption, one count line)", () => {
  it("names a lone blocked diver outright — the answer, not a door to the list", () => {
    renderBoard([
      departure({ blocked: 1, blockedAshoreNames: ["Priya Sharma"], ready: 3, boarded: 0 }),
    ]);
    expect(
      screen.getByText("Priya Sharma cannot board yet — the fix is in the list below."),
    ).toBeInTheDocument();
    // The old three-tile stat grid is gone: readiness is one caption now, so
    // its words must not also render as detached labelled counters.
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.queryByText("Boarded")).toBeNull();
  });

  it("falls back to the count when several divers are blocked", () => {
    renderBoard([
      departure({ blocked: 2, blockedAshoreNames: ["Priya Sharma", "Lena Fischer"], ready: 2 }),
    ]);
    expect(
      screen.getByText("2 divers cannot board yet — they are in the list below."),
    ).toBeInTheDocument();
  });

  it("keeps the exact counts visible in words — the bar stays decorative", () => {
    renderBoard([departure({ blocked: 1, ready: 3, boarded: 0, booked: 4, capacity: 10 })]);
    expect(
      screen.getByText("0 aboard · 3 clear to board · 1 blocked · 6 seats open"),
    ).toBeInTheDocument();
  });

  it("says all clear when nobody is blocked", () => {
    renderBoard([departure({ blocked: 0, ready: 4, boarded: 0 })]);
    expect(screen.getByText(COPY.clearToBoard)).toBeInTheDocument();
  });

  it("celebrates the full boat", () => {
    renderBoard([departure({ blocked: 0, ready: 0, boarded: 4 })]);
    expect(screen.getByText(COPY.everyoneAboard)).toBeInTheDocument();
  });

  /**
   * **Divers alone were never the whole boat** (`docs/product/glossary.md`).
   *
   * This card celebrated on `boarded === booked`, which counts bookings — so
   * Today threw confetti while the manifest, reading the very same departure,
   * correctly refused to close the checkpoint because a named crew member had
   * no result. Two surfaces, one fact, two answers (issue #789), and the one
   * state where somebody may still be in the water is exactly the state it got
   * wrong.
   */
  it("does not celebrate a full boat whose crew has not been counted", () => {
    renderBoard([
      departure({
        blocked: 0,
        ready: 0,
        boarded: 4,
        crewAccountedFor: false,
        crewReason: "crew_awaiting",
      }),
    ]);
    expect(screen.queryByText(COPY.everyoneAboard)).toBeNull();
    // And it says so, rather than falling back to "clear to board" — nothing
    // else on this card would tell a crew the roll call is still open.
    expect(screen.getByText(COPY.crewRollCallOpen)).toBeInTheDocument();
    expect(screen.queryByText(COPY.clearToBoard)).toBeNull();
  });

  it("says the same for a crew member recorded as not back aboard", () => {
    renderBoard([
      departure({
        blocked: 0,
        ready: 0,
        boarded: 4,
        crewAccountedFor: false,
        crewReason: "crew_not_back_aboard",
      }),
    ]);
    expect(screen.getByText(COPY.crewRollCallOpen)).toBeInTheDocument();
  });

  /**
   * A departure with nobody rostered is a coverage gap the page already raises
   * as its own row. Saying it a second time here buys nothing, so this one
   * state falls through — it still does not celebrate.
   */
  it("stays quiet about the crew when none is assigned, and still does not celebrate", () => {
    renderBoard([
      departure({
        blocked: 0,
        ready: 0,
        boarded: 4,
        crew: [],
        crewAccountedFor: false,
        crewReason: "crew_none_assigned",
      }),
    ]);
    expect(screen.queryByText(COPY.everyoneAboard)).toBeNull();
    expect(screen.queryByText(COPY.crewRollCallOpen)).toBeNull();
    expect(screen.getByText(COPY.clearToBoard)).toBeInTheDocument();
  });

  /**
   * **The card must not describe a gate as standing in front of someone who is
   * already past it.**
   *
   * On the seeded demo shop this read, verbatim: "8 aboard · 5 clear to board ·
   * 3 blocked · 4 seats open" followed by "3 divers cannot board yet — they are
   * in the list below." The same eight people. Worse than a wording slip: a
   * blocked diver *on the boat* is the more urgent fact, and the card was
   * stating the less urgent one, so a staffer scanning Today read "there is
   * still time" about a boat where there is none (issue #698).
   *
   * The suite had never rendered this — every case here set `boarded: 0`.
   */
  it("says a blocked diver is aboard, not that they cannot board yet", () => {
    renderBoard([
      departure({
        booked: 8,
        ready: 5,
        blocked: 3,
        blockedAboard: 3,
        blockedAboardGroups: [
          { kind: "payment", names: Array.from({ length: 3 }, (_, i) => `Owes ${i}`) },
        ],
        boarded: 8,
      }),
    ]);

    expect(
      screen.getByText(`3 divers are aboard — ${COPY.aboardReasonPayment}`),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cannot board yet/)).toBeNull();
  });

  it("keeps both facts when some blocked divers are aboard and some are not", () => {
    renderBoard([
      departure({
        booked: 8,
        ready: 3,
        blocked: 5,
        blockedAboard: 2,
        blockedAboardGroups: [
          { kind: "payment", names: Array.from({ length: 2 }, (_, i) => `Owes ${i}`) },
        ],
        boarded: 5,
      }),
    ]);

    // Neither number covers the other's people, so neither line may swallow
    // the other. Aboard leads: it is the one nobody can still act on in time.
    expect(
      screen.getByText(`2 divers are aboard — ${COPY.aboardReasonPayment}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText("3 divers cannot board yet — they are in the list below."),
    ).toBeInTheDocument();
  });

  it("still celebrates a full boat that had nobody blocked", () => {
    renderBoard([departure({ booked: 4, blocked: 0, ready: 0, boarded: 4 })]);
    expect(screen.getByText(COPY.everyoneAboard)).toBeInTheDocument();
  });

  /**
   * **Which blocker, because the gate is behind them.**
   *
   * Both lines used to end "the fix is in the list below" — clerical guidance,
   * right for the ashore group and wrong for a diver already on the boat (issue
   * #791). The four kinds are not the requirement families: an unsigned waiver
   * is *no medical declaration*, not filing, and only money is office work.
   */
  it.each([
    ["medical", COPY.aboardReasonMedical],
    ["unknown", COPY.aboardReasonUnknown],
    ["certification", COPY.aboardReasonCertification],
    ["payment", COPY.aboardReasonPayment],
  ] as const)("names a %s blocker on the aboard line", (kind, reason) => {
    renderBoard([
      departure({
        booked: 4,
        ready: 3,
        blocked: 1,
        blockedAboard: 1,
        blockedAboardGroups: [{ kind, names: ["Priya Sharma"] }],
        boarded: 4,
      }),
    ]);
    expect(screen.getByText(`Priya Sharma is aboard — ${reason}`)).toBeInTheDocument();
  });

  /**
   * **One line per kind — never one reason over a whole count.**
   *
   * The first cut of this reduced the aboard group to a single worst kind and
   * rendered it against the group's total, so one medical hold beside two
   * certification gaps read "3 divers are aboard — a medical hold", false about
   * two of the three. Run the other way and the two vanish behind the one the
   * crew was told about (`dive-domain-expert`, on issue #791).
   */
  it("gives each kind aboard its own true line, worst first", () => {
    renderBoard([
      departure({
        booked: 8,
        ready: 5,
        blocked: 3,
        blockedAboard: 3,
        blockedAboardGroups: [
          { kind: "medical", names: ["Priya Sharma"] },
          { kind: "certification", names: ["Lena Fischer", "Tom Okafor"] },
        ],
        boarded: 8,
      }),
    ]);

    expect(
      screen.getByText(`Priya Sharma is aboard — ${COPY.aboardReasonMedical}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`2 divers are aboard — ${COPY.aboardReasonCertification}`),
    ).toBeInTheDocument();
    // And the medical reason is never said about the other two.
    expect(screen.queryByText(`3 divers are aboard — ${COPY.aboardReasonMedical}`)).toBeNull();
  });

  /**
   * **The mixed boat, which named nobody.**
   *
   * The names were one flat list while the counts were split, and each line's
   * naming condition read `blocked === 1`. So a boat with one diver blocked
   * aboard and one blocked ashore rendered two lines, one person each, both
   * known by name — and named neither.
   */
  it("names each lone diver on a boat with one blocked aboard and one ashore", () => {
    renderBoard([
      departure({
        booked: 6,
        ready: 4,
        blocked: 2,
        blockedAboard: 1,
        blockedAboardGroups: [{ kind: "medical", names: ["Priya Sharma"] }],
        blockedAshore: 1,
        blockedAshoreNames: ["Lena Fischer"],
        boarded: 4,
      }),
    ]);

    expect(
      screen.getByText(`Priya Sharma is aboard — ${COPY.aboardReasonMedical}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Lena Fischer cannot board yet — the fix is in the list below."),
    ).toBeInTheDocument();
  });

  it("does not fall silent on a full boat carrying a blocked diver", () => {
    // `blocked > 0` was checked before `boarded === booked`, so this departure
    // got the blocked line and never the celebration; with the blocked count
    // split it must still get a line rather than nothing.
    renderBoard([
      departure({
        booked: 4,
        ready: 3,
        blocked: 1,
        blockedAboard: 1,
        blockedAboardGroups: [{ kind: "payment", names: ["Osric Bell"] }],
        boarded: 4,
      }),
    ]);

    // A lone diver is named, which is the point of naming them at all.
    expect(
      screen.getByText(`Osric Bell is aboard — ${COPY.aboardReasonPayment}`),
    ).toBeInTheDocument();
    expect(screen.queryByText(COPY.everyoneAboard)).toBeNull();
  });

  it("says nothing about a no-show's blocker on a boat that has sailed", () => {
    // Marked `not_boarded` at departure: they never left the dock, so they are
    // in neither count. "Their waiver is unsigned" is noise about a boat that
    // has gone without them — and the card falls through to the clear-to-board
    // line, which is true of everyone who actually sailed.
    renderBoard([
      departure({
        booked: 4,
        ready: 3,
        blocked: 1,
        blockedAboard: 0,
        blockedAshore: 0,
        boarded: 3,
      }),
    ]);

    expect(screen.queryByText(/cannot board yet/)).toBeNull();
    expect(screen.queryByText(/unresolved blocker/)).toBeNull();
    // The counts line still reports the roster fact — that number is right.
    expect(screen.getByText(/3 aboard · 3 clear to board · 1 blocked/)).toBeInTheDocument();
    // **And the card says nothing else.** Going quiet about a blocker is
    // allowed; affirming the opposite is not. This state used to fall through
    // to "Everyone booked on this trip is clear to board", three pixels under a
    // counts line reading "1 blocked" (found by `dive-domain-expert`).
    expect(screen.queryByText(COPY.clearToBoard)).toBeNull();
    expect(screen.queryByText(COPY.everyoneAboard)).toBeNull();
  });

  it("teaches the empty boat instead of rendering zeros", () => {
    renderBoard([departure({ booked: 0, blocked: 0, ready: 0, boarded: 0 })]);
    expect(screen.getByText(COPY.noneBooked)).toBeInTheDocument();
    // An empty boat has no counts worth a line — zeros are not information.
    expect(screen.queryByText(/aboard ·/)).toBeNull();
  });
});

describe("DepartureBoard crew line and disclosure", () => {
  it("states the crew in one quiet line and keeps the editor behind it", () => {
    const { container } = renderBoard([departure()]);
    expect(screen.getByText("Crew · Keiko Tanaka")).toBeInTheDocument();
    // The editor is a native disclosure, closed at rest — the card's everyday
    // read is the line, not a form.
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("names the gap when nobody is assigned", () => {
    renderBoard([departure({ crew: [] })]);
    expect(screen.getByText(COPY.noCrewAssigned)).toBeInTheDocument();
  });

  it("assigns through the select and shows the name only after the server confirms", async () => {
    let resolveAction: (result: { ok: boolean }) => void = () => {};
    const updateCrewAction = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveAction = resolve;
        }),
    );
    renderBoard([departure()], updateCrewAction);

    const assign = screen.getByRole("combobox", {
      name: /assign crew member to morning reef dive/i,
    });
    await act(async () => {
      fireEvent.change(assign, { target: { value: "staff-2" } });
    });

    // A staffer reading the board right after the change (or tapping "Open
    // guests" on this same card) must never see the crew as assigned before
    // the write that makes it true has actually landed — same reasoning as
    // CrewSection.tsx's confirm-then-render.
    expect(screen.queryByRole("button", { name: /unassign sal moretti/i })).toBeNull();

    await act(async () => {
      resolveAction({ ok: true });
    });

    expect(screen.getByRole("button", { name: /unassign sal moretti/i })).toBeInTheDocument();
    expect(updateCrewAction).toHaveBeenCalledWith("trip-1", {
      personId: "staff-2",
      operation: "assign",
    });
  });

  it("says so when the assignment fails, instead of silently reverting", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: false });
    renderBoard([departure()], updateCrewAction);

    const assign = screen.getByRole("combobox", {
      name: /assign crew member to morning reef dive/i,
    });
    await act(async () => {
      fireEvent.change(assign, { target: { value: "staff-2" } });
    });

    expect(screen.queryByRole("button", { name: /unassign sal moretti/i })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(COPY.assignFailed);
  });

  it("keeps the failure message when the action throws", async () => {
    const updateCrewAction = vi.fn().mockRejectedValue(new Error("network unavailable"));
    renderBoard([departure()], updateCrewAction);

    const assign = screen.getByRole("combobox", {
      name: /assign crew member to morning reef dive/i,
    });
    await act(async () => {
      fireEvent.change(assign, { target: { value: "staff-2" } });
    });

    expect(screen.queryByRole("button", { name: /unassign sal moretti/i })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(COPY.assignFailed);
  });

  it("removes crew on unassign once the server confirms, and calls updateCrewAction", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    renderBoard([departure()], updateCrewAction);

    const unassignButton = screen.getByRole("button", { name: /unassign keiko tanaka/i });
    await act(async () => {
      fireEvent.click(unassignButton);
    });

    expect(screen.queryByRole("button", { name: /unassign keiko tanaka/i })).toBeNull();
    expect(updateCrewAction).toHaveBeenCalledWith("trip-1", {
      personId: "staff-1",
      operation: "unassign",
    });
  });
});
