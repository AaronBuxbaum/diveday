// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DepartureBoard, type DepartureBoardCopy } from "./DepartureBoard";

afterEach(() => {
  cleanup();
});

const COPY: DepartureBoardCopy = {
  crewingBadge: "You’re crewing",
  courseSession: "Course session · {title}",
  bookedOfCapacity: "{booked} of {capacity} booked",
  boarding: "Boarding",
  openGuests: "Open guests",
  crewDropZoneAria: "Crew assignments drop zone",
  assignCrewMemberAria: "Assign crew member to {title}",
  assignedCrewHeading: "Assigned crew",
  assignCrewOption: "Assign crew…",
  unassignAria: "Unassign {name}",
  noCrewAssigned: "No crew assigned yet.",
  assignCrewLabel: "Assign crew",
  assignFailed: "That didn’t save — recheck your connection or try again.",
  countReady: "Ready",
  countBlocked: "Blocked",
  countBoarded: "Boarded",
  blockedWarningOne: "{count} diver cannot board yet — they are in the list below.",
  blockedWarningOther: "{count} divers cannot board yet — they are in the list below.",
  noneBooked: "No one’s booked yet — share the trip page and they’ll show up here.",
  everyoneAboard: "Everyone’s aboard.",
  clearToBoard: "Everyone aboard this trip is clear to board.",
  sailingToday: "Sailing today",
  sailingTodaySubtitle:
    "Check divers in at the counter or run roll call from the manifest — readiness is rechecked the moment you board someone.",
  dragStaffLabel: "Drag staff to assign:",
};

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
        locale="en-US"
        availableStaff={availableStaff}
        updateCrewAction={updateCrewAction}
        copy={COPY}
      />,
    );

    expect(screen.getByRole("button", { name: /unassign keiko tanaka/i })).toBeInTheDocument();
    expect(screen.getByText("Sal Moretti 👤")).toBeInTheDocument();
    // The dropdown is the primary way to crew a boat — its label must be
    // visible on the page, not only reachable via aria-label, since
    // drag-and-drop above it doesn't work on a phone.
    expect(screen.getByText(COPY.assignCrewLabel)).toBeVisible();
  });

  /**
   * The default drag image is the browser's own snapshot of the element, and
   * the staff pill's fill is translucent — lifted off the page there is
   * nothing behind that tint, so the snapshot gets composited onto white and
   * the name drags around inside a white square. The fix is an opaque clone
   * handed to `setDragImage`, torn down when the drag ends.
   */
  it("drags an opaque clone of the staff pill, not the see-through original", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    render(
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

    const pill = screen.getByText("Sal Moretti 👤");
    const setDragImage = vi.fn();
    const setData = vi.fn();
    fireEvent.dragStart(pill, { dataTransfer: { setData, setDragImage } });

    expect(setData).toHaveBeenCalledWith("text/plain", "staff-2");
    expect(setDragImage).toHaveBeenCalledTimes(1);
    const ghost = setDragImage.mock.calls[0]?.[0] as HTMLElement;
    // In the document (setDragImage reads nothing else), off-screen, and with
    // the tint flattened so the drag has a backdrop of its own.
    expect(ghost.isConnected).toBe(true);
    expect(ghost.textContent).toContain("Sal Moretti");
    expect(ghost.style.background).not.toBe("");
    expect(ghost.style.left).toBe("-1000px");

    // Every drag ends in a `dragend`, cancelled or dropped — so nothing is left
    // behind the page after one.
    fireEvent.dragEnd(pill);
    expect(ghost.isConnected).toBe(false);
  });

  it("adds crew on drop once the server confirms, and calls updateCrewAction", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    render(
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

    const dropZone = screen.getByText("Assigned crew").closest("section");
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

  it("highlights the drop zone on dragenter and clears it on dragleave/drop", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    render(
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

    const dropZone = screen.getByText("Assigned crew").closest("section");
    if (!dropZone) throw new Error("Drop zone not found");

    // Checked as a class-list token, not a substring, since the zone's
    // always-on hover affordance is "hover:border-primary/40".
    expect(dropZone.classList.contains("border-primary")).toBe(false);

    await act(async () => {
      fireEvent.dragEnter(dropZone);
    });
    expect(dropZone.classList.contains("border-primary")).toBe(true);
    expect(dropZone.classList.contains("bg-primary/5")).toBe(true);

    // A child firing its own dragenter/dragleave as the pointer crosses it
    // must not drop the highlight — only the depth counter hitting 0 does.
    // Real drag events enter the new (child) target before leaving the old
    // (parent) one, so simulate that order: enter child, then leave parent.
    const heading = screen.getByText(COPY.assignedCrewHeading);
    await act(async () => {
      fireEvent.dragEnter(heading);
    });
    await act(async () => {
      fireEvent.dragLeave(dropZone);
    });
    expect(dropZone.classList.contains("border-primary")).toBe(true);

    // Now the pointer actually leaves the zone via the child.
    await act(async () => {
      fireEvent.dragLeave(heading);
    });
    expect(dropZone.classList.contains("border-primary")).toBe(false);

    await act(async () => {
      fireEvent.dragEnter(dropZone);
    });
    expect(dropZone.classList.contains("border-primary")).toBe(true);

    const dropEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: vi.fn().mockReturnValue("staff-2"),
      },
    };
    await act(async () => {
      fireEvent.drop(dropZone, dropEvent);
    });
    expect(dropZone.classList.contains("border-primary")).toBe(false);
  });

  it("offers a keyboard-accessible assignment control", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    render(
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
        locale="en-US"
        availableStaff={availableStaff}
        updateCrewAction={updateCrewAction}
        copy={COPY}
      />,
    );

    const dropZone = screen.getByText("Assigned crew").closest("section");

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
    // A silent revert reads as "nothing happened" — the rollback must say so.
    expect(screen.getByRole("alert")).toHaveTextContent(COPY.assignFailed);
  });

  it("rolls back crew assignment when updateCrewAction throws", async () => {
    const updateCrewAction = vi.fn().mockRejectedValue(new Error("network unavailable"));
    render(
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

    const dropZone = screen.getByText("Assigned crew").closest("section");
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
    expect(screen.getByRole("alert")).toHaveTextContent(COPY.assignFailed);
  });

  it("removes crew on unassign once the server confirms, and calls updateCrewAction", async () => {
    const updateCrewAction = vi.fn().mockResolvedValue({ ok: true });
    render(
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

  it("doesn't show a newly assigned crew member until the server confirms the write", async () => {
    let resolveAction: (result: { ok: boolean }) => void = () => {};
    const updateCrewAction = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(
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

    const dropZone = screen.getByText("Assigned crew").closest("section");
    if (!dropZone) throw new Error("Drop zone not found");
    const dropEvent = {
      preventDefault: vi.fn(),
      dataTransfer: { getData: vi.fn().mockReturnValue("staff-2") },
    };

    await act(async () => {
      fireEvent.drop(dropZone, dropEvent);
    });

    // A staffer reading the board right after the drop (or tapping "Open
    // guests" on this same card) must never see the crew as assigned before
    // the write that makes it true has actually landed — same reasoning as
    // CrewSection.tsx's confirm-then-render fix, for the identical
    // updateCrewAction/course_unstaffed gate.
    expect(screen.queryByRole("button", { name: /unassign sal moretti/i })).toBeNull();

    await act(async () => {
      resolveAction({ ok: true });
    });

    expect(screen.getByRole("button", { name: /unassign sal moretti/i })).toBeInTheDocument();
  });
});
