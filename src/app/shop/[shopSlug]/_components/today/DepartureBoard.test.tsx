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
  noneBooked: "No one’s booked yet — share the trip page and they’ll show up here.",
  everyoneAboard: "Everyone’s aboard.",
  clearToBoard: "Everyone booked on this trip is clear to board.",
  sailingToday: "Sailing today",
  sailingTodaySubtitle:
    "Check divers in at the counter or run roll call from the manifest — readiness is rechecked the moment you board someone.",
};

const availableStaff = [
  { id: "staff-1", fullName: "Keiko Tanaka", roles: ["divemaster"] },
  { id: "staff-2", fullName: "Sal Moretti", roles: ["captain"] },
];

function departure(overrides: Partial<DepartureSummary> = {}): DepartureSummary {
  return {
    tripId: "trip-1",
    title: "Morning Reef Dive",
    startsAt: new Date("2026-07-28T09:00:00Z"),
    endsAt: new Date("2026-07-28T12:00:00Z"),
    booked: 4,
    capacity: 10,
    ready: 3,
    blocked: 1,
    blockedNames: [],
    boarded: 0,
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
