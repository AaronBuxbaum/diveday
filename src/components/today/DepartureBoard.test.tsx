// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DepartureBoard } from "./DepartureBoard";

afterEach(() => {
  cleanup();
});

describe("DepartureBoard Drag and Drop Crew Assign", () => {
  const departures = [
    {
      tripId: "trip-1",
      title: "Morning Reef Dive",
      startsAt: new Date("2026-07-28T09:00:00Z"),
      endsAt: new Date("2026-07-28T12:00:00Z"),
      booked: 4,
      capacity: 10,
      ready: 3,
      blocked: 1,
      boarded: 2,
      courseTitle: null,
      crew: [{ id: "staff-1", fullName: "Keiko Tanaka", roles: ["divemaster"] }],
    },
  ];

  const availableStaff = [
    { id: "staff-1", fullName: "Keiko Tanaka", roles: ["divemaster"] },
    { id: "staff-2", fullName: "Sal Moretti", roles: ["captain"] },
  ];

  it("renders assigned crew and available staff", () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <DepartureBoard
        departures={departures}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        availableStaff={availableStaff}
        updateCrewAction={updateCrewAction}
      />,
    );

    expect(screen.getByRole("button", { name: /unassign keiko tanaka/i })).toBeInTheDocument();
    expect(screen.getByText("Sal Moretti 👤")).toBeInTheDocument();
  });

  it("optimistically adds crew on drop and calls updateCrewAction", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <DepartureBoard
        departures={departures}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        availableStaff={availableStaff}
        updateCrewAction={updateCrewAction}
      />,
    );

    const dropZone = screen.getByText(/Drag staff here to assign/i).closest("section");
    expect(dropZone).not.toBeNull();

    const dropEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: vi.fn().mockReturnValue("staff-2"),
      },
    };

    if (!dropZone) throw new Error("Drop zone not found");
    await act(async () => {
      fireEvent.drop(dropZone, dropEvent);
    });

    expect(screen.getByRole("button", { name: /unassign sal moretti/i })).toBeInTheDocument();
    expect(updateCrewAction).toHaveBeenCalledWith("trip-1", {
      personId: "staff-2",
      operation: "assign",
    });
  });

  it("offers a keyboard-accessible assignment control", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <DepartureBoard
        departures={departures}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        availableStaff={availableStaff}
        updateCrewAction={updateCrewAction}
      />,
    );

    const assign = screen.getByRole("combobox", {
      name: /assign crew member to morning reef dive/i,
    });
    await act(async () => {
      fireEvent.change(assign, { target: { value: "staff-2" } });
    });

    expect(screen.getByText("Sal Moretti")).toBeInTheDocument();
    expect(updateCrewAction).toHaveBeenCalledWith("trip-1", {
      personId: "staff-2",
      operation: "assign",
    });
  });

  it("rolls back crew assignment when updateCrewAction fails", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: false });
    render(
      <DepartureBoard
        departures={departures}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        availableStaff={availableStaff}
        updateCrewAction={updateCrewAction}
      />,
    );

    const dropZone = screen.getByText(/Drag staff here to assign/i).closest("section");

    const dropEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: vi.fn().mockReturnValue("staff-2"),
      },
    };

    if (!dropZone) throw new Error("Drop zone not found");
    await act(async () => {
      fireEvent.drop(dropZone, dropEvent);
    });

    expect(screen.queryByRole("button", { name: /unassign sal moretti/i })).toBeNull();
  });

  it("rolls back crew assignment when updateCrewAction throws", async () => {
    const updateCrewAction = vi.fn().mockRejectedValue(new Error("network unavailable"));
    render(
      <DepartureBoard
        departures={departures}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        availableStaff={availableStaff}
        updateCrewAction={updateCrewAction}
      />,
    );

    const dropZone = screen.getByText(/Drag staff here to assign/i).closest("section");
    const dropEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: vi.fn().mockReturnValue("staff-2"),
      },
    };

    if (!dropZone) throw new Error("Drop zone not found");
    await act(async () => {
      fireEvent.drop(dropZone, dropEvent);
    });

    expect(screen.queryByRole("button", { name: /unassign sal moretti/i })).toBeNull();
  });

  it("optimistically removes crew on unassign button click and calls updateCrewAction", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <DepartureBoard
        departures={departures}
        shopSlug="blue-mantis"
        timeZone="America/New_York"
        availableStaff={availableStaff}
        updateCrewAction={updateCrewAction}
      />,
    );

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
