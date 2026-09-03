// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrewSection, type CrewSectionCopy } from "./CrewSection";
import type { StaffList } from "./types";

afterEach(cleanup);

/**
 * The shop's own target ratio (ADR 20260820-shop-divemaster-ratio) is advice,
 * and advice that is being met is not news. `underTargetNote` is null the
 * moment the departure clears the target, and nothing may remain on screen
 * congratulating the shop about it (design principle 9).
 */
describe("the shop's divemaster target", () => {
  const props = {
    tripId: "trip-1",
    staff: [] as StaffList,
    crewIds: [],
    crewRoles: {},
    onShiftIds: null,
    shopSlug: "blue-mantis",
    updateCrewAction: async () => ({ ok: true }),
  };

  it("says how short the departure is, without refusing anything", () => {
    render(
      <CrewSection
        {...props}
        crewGapCode="none"
        copy={{
          ...COPY,
          underTargetNote: "9 divers with no divemaster. Your 6:1 target wants 2 divemasters.",
        }}
      />,
    );
    expect(screen.getByText(/Your 6:1 target wants 2 divemasters/)).toBeTruthy();
  });

  it("says nothing at all once the target is met", () => {
    render(<CrewSection {...props} crewGapCode="none" copy={COPY} />);
    expect(screen.queryByText(/target wants/)).toBeNull();
  });
});

const COPY: CrewSectionCopy = {
  heading: "Crew",
  courseNeedsInstructor: "This course needs an instructor.",
  overRatioWarning: null,
  underTargetNote: null,
  languageGapNote: null,
  noStaff: "No staff on file yet.",
  notAssignedYet: "Nobody assigned yet.",
  assignLabel: "Assign crew",
  assignOption: "Choose someone…",
  unassignAria: "Remove {name} from crew",
  assignFailed: "Couldn't save that change.",
  onShift: "On shift",
  notOnShift: "Not on shift",
  manageShifts: "Manage shifts",
  roleAria: "Job {name} is doing on this trip",
  roleUnspecified: "Job not set",
  roleOptions: {
    instructor: "Instructor",
    divemaster: "Divemaster",
    captain: "Captain",
    crew: "Deck crew",
  },
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
        crewRoles={{}}
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
    // so if `cacheComponents: true`'s Activity-based navigation is ever
    // re-enabled, the stale banner from Trip A could otherwise survive into
    // Trip B's render (docs ADR 20260801-cache-components-activity-state,
    // currently reverted, commit 100fcf8) — the same effect that resyncs
    // `localCrew` from the server must also drop it.
    rerender(
      <CrewSection
        tripId="trip-b"
        staff={staff}
        crewRoles={{}}
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

describe("CrewSection confirm-then-render", () => {
  it("doesn't show a newly assigned crew member until the server confirms the write", async () => {
    let resolveAction: (result: { ok: boolean }) => void = () => {};
    const pending = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const staff: StaffList = [
      staffMember("staff-1", "Dana Reyes"),
      staffMember("staff-2", "Marcus Webb"),
    ];

    render(
      <CrewSection
        tripId="trip-a"
        staff={staff}
        crewRoles={{}}
        crewIds={["staff-1"]}
        onShiftIds={["staff-1"]}
        crewGapCode="none"
        shopSlug="blue-mantis"
        updateCrewAction={pending}
        copy={COPY}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Assign crew"), "staff-2");

    // A real user (or an e2e spec) reading the DOM right after clicking must
    // never see "assigned" before the write that makes it true has actually
    // landed — a caller relying on that signal (e.g. switching to a page
    // that re-checks the same requirement server-side) could otherwise
    // outrun the mutation. See the handleAssign/handleUnassign comment.
    expect(screen.queryByRole("button", { name: "Remove Marcus Webb from crew" })).toBeNull();
    expect(pending).toHaveBeenCalledWith("trip-a", { personId: "staff-2", operation: "assign" });

    resolveAction({ ok: true });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Remove Marcus Webb from crew" }),
      ).toBeInTheDocument();
    });
  });
});

/**
 * Review 20260803, D5. Nothing in the app wrote `trip_assignments.trip_role`
 * except the seed — `CrewSection`, Today's departure board and
 * `updateTripCrewAction` all assigned with no role — so for every real shop the
 * divemaster-rostered-as-captain over-count DOM-M3 fixed was 100% live, while
 * the glossary stated the fixed behaviour as fact. This is the control that
 * makes the field settable.
 */
describe("CrewSection per-trip role picker", () => {
  it("posts the job on this sailing through the same assign mutation, and only renders it once the server agrees", async () => {
    const calls: unknown[] = [];
    let resolveAction: (result: { ok: boolean }) => void = () => {};
    const action = vi.fn((_tripId: string, change: unknown) => {
      calls.push(change);
      return new Promise<{ ok: boolean }>((resolve) => {
        resolveAction = resolve;
      });
    });
    const staff: StaffList = [staffMember("staff-1", "Keiko Tanaka", ["divemaster"])];

    render(
      <CrewSection
        tripId="trip-a"
        staff={staff}
        crewRoles={{ "staff-1": null }}
        crewIds={["staff-1"]}
        onShiftIds={["staff-1"]}
        crewGapCode="none"
        shopSlug="blue-mantis"
        updateCrewAction={action}
        copy={COPY}
      />,
    );

    const picker = screen.getByLabelText("Job Keiko Tanaka is doing on this trip");
    expect((picker as HTMLSelectElement).value).toBe("");
    await userEvent.selectOptions(picker, "captain");
    expect(calls).toEqual([{ personId: "staff-1", operation: "assign", tripRole: "captain" }]);

    resolveAction({ ok: true });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Job Keiko Tanaka is doing on this trip") as HTMLSelectElement)
          .value,
      ).toBe("captain"),
    );
  });

  it("keeps the shown role at what the server holds when the write is refused", async () => {
    const refusing = vi.fn(async () => ({ ok: false }));
    const staff: StaffList = [staffMember("staff-1", "Keiko Tanaka", ["divemaster"])];

    render(
      <CrewSection
        tripId="trip-a"
        staff={staff}
        crewRoles={{ "staff-1": "captain" }}
        crewIds={["staff-1"]}
        onShiftIds={["staff-1"]}
        crewGapCode="none"
        shopSlug="blue-mantis"
        updateCrewAction={refusing}
        copy={COPY}
      />,
    );

    const picker = screen.getByLabelText("Job Keiko Tanaka is doing on this trip");
    await userEvent.selectOptions(picker, "divemaster");
    // The supervision ratio reads this field, so a refused write must never
    // leave the screen claiming a job the server did not accept.
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("Job Keiko Tanaka is doing on this trip") as HTMLSelectElement).value,
    ).toBe("captain");
  });
});

describe("CrewSection shift coverage", () => {
  it("warns per uncovered crew member at a shop that schedules shifts", () => {
    render(
      <CrewSection
        tripId="trip-a"
        staff={[staffMember("staff-1", "Dana Reyes"), staffMember("staff-2", "Ana Cruz")]}
        crewRoles={{}}
        crewIds={["staff-1", "staff-2"]}
        onShiftIds={["staff-1"]}
        crewGapCode="none"
        shopSlug="blue-mantis"
        updateCrewAction={vi.fn(async () => ({ ok: true }))}
        copy={COPY}
      />,
    );
    // One badge for the uncovered member, the quiet sr-only fact for the covered one.
    expect(screen.getAllByText("Not on shift")).toHaveLength(1);
    expect(screen.getByText("On shift")).toBeInTheDocument();
  });

  it("renders no coverage state at all when the shop has never scheduled a shift", () => {
    // The regression this pins: `onShiftIds === null` (crewShiftCoverage's
    // "the question does not apply") used to be indistinguishable from
    // "nobody is covered", so shops that never used the staffing feature saw
    // a permanent warning on every crew member of every trip.
    render(
      <CrewSection
        tripId="trip-a"
        staff={[staffMember("staff-1", "Dana Reyes")]}
        crewRoles={{}}
        crewIds={["staff-1"]}
        onShiftIds={null}
        crewGapCode="none"
        shopSlug="blue-mantis"
        updateCrewAction={vi.fn(async () => ({ ok: true }))}
        copy={COPY}
      />,
    );
    expect(screen.queryByText("Not on shift")).not.toBeInTheDocument();
    expect(screen.queryByText("On shift")).not.toBeInTheDocument();
  });
});
