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
  bookedOfCapacity: "{booked} of {capacity} booked",
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
  boardingSummary:
    "{boarded} aboard · {ready} clear to board · {blocked} blocked · {open} seats open",
  blockedWarningNamed: "{name} cannot board yet — the fix is in the list below.",
  blockedWarningOne: "{count} diver cannot board yet — they are in the list below.",
  blockedWarningOther: "{count} divers cannot board yet — they are in the list below.",
  blockedAboardNamed: "{name} is aboard with an unresolved blocker — the fix is in the list below.",
  blockedAboardOne:
    "{count} diver is aboard with an unresolved blocker — they are in the list below.",
  blockedAboardOther:
    "{count} divers are aboard with unresolved blockers — they are in the list below.",
  noneBooked: "No one’s booked yet — share the trip page and they’ll show up here.",
  everyoneAboard: "Everyone’s aboard.",
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
    blockedNames: [],
    boarded: 0,
    blockedAboard,
    blockedAshore: Math.max(0, blocked - blockedAboard),
    courseTitle: null,
    crew: [{ id: "staff-1", fullName: "Keiko Tanaka", roles: ["divemaster"] }],
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

describe("DepartureBoard readiness caption (one bar, one caption, one count line)", () => {
  it("names a lone blocked diver outright — the answer, not a door to the list", () => {
    renderBoard([departure({ blocked: 1, blockedNames: ["Priya Sharma"], ready: 3, boarded: 0 })]);
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
      departure({ blocked: 2, blockedNames: ["Priya Sharma", "Lena Fischer"], ready: 2 }),
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
    renderBoard([departure({ booked: 8, ready: 5, blocked: 3, blockedAboard: 3, boarded: 8 })]);

    expect(
      screen.getByText(
        "3 divers are aboard with unresolved blockers — they are in the list below.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cannot board yet/)).toBeNull();
  });

  it("keeps both facts when some blocked divers are aboard and some are not", () => {
    renderBoard([departure({ booked: 8, ready: 3, blocked: 5, blockedAboard: 2, boarded: 5 })]);

    // Neither number covers the other's people, so neither line may swallow
    // the other. Aboard leads: it is the one nobody can still act on in time.
    expect(
      screen.getByText(
        "2 divers are aboard with unresolved blockers — they are in the list below.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("3 divers cannot board yet — they are in the list below."),
    ).toBeInTheDocument();
  });

  it("still celebrates a full boat that had nobody blocked", () => {
    renderBoard([departure({ booked: 4, blocked: 0, ready: 0, boarded: 4 })]);
    expect(screen.getByText(COPY.everyoneAboard)).toBeInTheDocument();
  });

  it("does not fall silent on a full boat carrying a blocked diver", () => {
    // `blocked > 0` was checked before `boarded === booked`, so this departure
    // got the blocked line and never the celebration; with the blocked count
    // split it must still get a line rather than nothing.
    renderBoard([departure({ booked: 4, ready: 3, blocked: 1, blockedAboard: 1, boarded: 4 })]);

    expect(
      screen.getByText(
        "1 diver is aboard with an unresolved blocker — they are in the list below.",
      ),
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
