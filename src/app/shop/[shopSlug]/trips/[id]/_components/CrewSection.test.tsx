// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrewSection, type CrewSectionCopy } from "./CrewSection";
import type { StaffList } from "./types";

afterEach(cleanup);

const COPY: CrewSectionCopy = {
  heading: "Crew",
  description: "Who's running this trip.",
  courseNeedsInstructor: "This course needs an instructor.",
  overRatioWarning: null,
  noStaff: "No staff on file yet.",
  notAssignedYet: "Nobody assigned yet.",
  assignLabel: "Assign crew",
  assignOption: "Choose someone…",
  unassignAria: "Remove {name} from crew",
  assignFailed: "Couldn't save that change.",
  onShift: "On shift",
  notOnShift: "Not on shift",
  manageShifts: "Manage shifts",
};

function staffMember(id: string, fullName: string, roles: string[] = ["instructor"]) {
  return {
    // CrewSection only ever reads `person.id`/`person.fullName` off this —
    // the full `people` row shape isn't exercised here.
    person: { id, fullName } as unknown as StaffList[number]["person"],
    roles,
  } satisfies StaffList[number];
}

describe("CrewSection assignError reset on revisit", () => {
  it("clears a stale assign-failed banner once the server's own crew data resyncs (e.g. a trip switch)", async () => {
    const failing = vi.fn(async () => ({ ok: false }));
    const staff: StaffList = [
      staffMember("staff-1", "Dana Reyes"),
      staffMember("staff-2", "Ana Cruz"),
    ];

    const { rerender } = render(
      <CrewSection
        tripId="trip-a"
        staff={staff}
        crewIds={["staff-1"]}
        onShiftIds={["staff-1"]}
        crewGapCode="none"
        shopSlug="blue-mantis"
        updateCrewAction={failing}
        copy={COPY}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Assign crew"), "staff-2");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save that change.");
    });

    // Trip A -> Trip B: the server sends fresh crewIds/staff for the new
    // trip. This route has no dynamic key of its own for the crew section,
    // so under `cacheComponents: true` the stale banner from Trip A could
    // otherwise survive into Trip B's render (docs ADR
    // 20260801-cache-components-activity-state) — the same effect that
    // resyncs `localCrew` from the server must also drop it.
    rerender(
      <CrewSection
        tripId="trip-b"
        staff={staff}
        crewIds={["staff-1"]}
        onShiftIds={["staff-1"]}
        crewGapCode="none"
        shopSlug="blue-mantis"
        updateCrewAction={failing}
        copy={COPY}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
