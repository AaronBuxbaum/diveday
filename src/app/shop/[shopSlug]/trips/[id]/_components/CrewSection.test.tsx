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
  assignFailed: "Couldn’t save that change.",
  assignClash: "{name} is already crewing another departure at these hours and cannot be on both.",
  clash: "Also crewing {departure} at these hours and cannot be on both.",
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
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t save that change.");
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

/**
 * **The clash a staffer used to have to open the Move panel to learn about**
 * (issue #1695). Three writes manufacture it, each of which moves the boat
 * without reading the roster — `moveTrip`, the Details form two panels above
 * this one, and reinstating a called-off departure (`crewClashes` names all
 * three) — and until this row carried the mark, the only panel that ever warned
 * about any of them had already closed.
 *
 * Two things are pinned here and both were the point: the other boat is
 * **named** (the question the reader has the instant they see the mark), and
 * the mark refuses nothing — the owner assigns crew (#1345), so every control
 * on the row keeps working.
 *
 * The role is `status`, never `alert` (dive-domain-expert review, 2026-09-12).
 * The line is rendered with the page, so on a cold load a live region already
 * present at first paint has no change to announce and on a soft navigation an
 * `alert` interrupts — the announcement was a coin flip on how the reader
 * arrived, at the volume reserved for something that just happened. A standing
 * condition is `status` at most; the weight is carried by *where* it is drawn,
 * which is the trip page's About summary row (`page.tsx`), because this panel
 * lives inside a disclosure that is closed on an ordinary visit.
 */
describe("CrewSection standing crew clash", () => {
  const props = {
    tripId: "trip-a",
    staff: [staffMember("staff-1", "Marisol Vega"), staffMember("staff-2", "Ana Cruz")],
    crewRoles: {},
    crewIds: ["staff-1", "staff-2"],
    onShiftIds: null,
    crewGapCode: "none" as const,
    shopSlug: "blue-mantis",
  };

  it("names the other departure, on the row of the person who is on both", () => {
    render(
      <CrewSection
        {...props}
        clashes={[
          { personId: "staff-1", otherTripId: "trip-b", otherTitle: "The 09:00 reef drift" },
        ]}
        updateCrewAction={vi.fn(async () => ({ ok: true }))}
        copy={COPY}
      />,
    );
    const marks = screen.getAllByRole("status");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent(
      "Also crewing The 09:00 reef drift at these hours and cannot be on both.",
    );
    // Never `alert`: a statically rendered live region announces on a soft
    // navigation and stays silent on a cold load, which is the wrong half of
    // the time either way.
    expect(screen.queryByRole("alert")).toBeNull();
    // On her row, not the section's: the name is already the line above it, so
    // the sentence spends its words on the boat she is double-booked onto.
    expect(screen.getByText("Marisol Vega").closest("li")).toContainElement(marks[0]);
    expect(screen.getByText("Ana Cruz").closest("li")).not.toContainElement(marks[0]);
  });

  it("still lets the owner work the roster — it informs, it does not gate", async () => {
    const updateCrewAction = vi.fn(async () => ({ ok: true }));
    render(
      <CrewSection
        {...props}
        clashes={[
          { personId: "staff-1", otherTripId: "trip-b", otherTitle: "The 09:00 reef drift" },
        ]}
        updateCrewAction={updateCrewAction}
        copy={COPY}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Marisol Vega from crew" }));
    await waitFor(() =>
      expect(updateCrewAction).toHaveBeenCalledWith("trip-a", {
        personId: "staff-1",
        operation: "unassign",
      }),
    );
  });

  /**
   * The silent case, which is every ordinary departure: a morning two-tank and
   * an afternoon single are how a divemaster works a Saturday, so a panel that
   * marked them would be the saturation failure #757 and #1203 paid for once.
   */
  it("says nothing at all when no crew member is on two boats", () => {
    render(
      <CrewSection {...props} updateCrewAction={vi.fn(async () => ({ ok: true }))} copy={COPY} />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/cannot be on both/)).toBeNull();
  });

  /**
   * **Trying to create one is not a network failure** (dive-domain-expert
   * review, 2026-09-12). Every `ok: false` reached `assignFailed` — "Recheck
   * your connection or try again" — so the panel that explains this state in
   * exact words told the staffer who had just walked into it to check their
   * signal. At a dock the next move is to tap again, or to go and widen the
   * other departure's hours until it sticks, which manufactures the state.
   */
  it("says which refusal it was when an assignment would create a clash", async () => {
    const updateCrewAction = vi.fn(async () => ({
      ok: false as const,
      refusal: "crew_clash" as const,
    }));
    render(
      <CrewSection
        {...props}
        staff={[staffMember("staff-1", "Marisol Vega"), staffMember("staff-2", "Ana Cruz")]}
        crewIds={["staff-1"]}
        updateCrewAction={updateCrewAction}
        copy={COPY}
      />,
    );
    await screen.findByRole("combobox", { name: "Assign crew" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Assign crew" }), "staff-2");

    expect(
      await screen.findByText(
        "Ana Cruz is already crewing another departure at these hours and cannot be on both.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t save that change.")).toBeNull();
    // Refused, so nothing was added to the roster on screen either.
    expect(screen.queryByLabelText("Remove Ana Cruz from crew")).toBeNull();
  });

  /**
   * And every other refusal keeps the sentence it has always had — a refusal
   * code per branch would be a vocabulary to keep in step with a message
   * bundle, and none of the others has a different next move.
   */
  it("keeps the general sentence for a refusal with no reason to give", async () => {
    const updateCrewAction = vi.fn(async () => ({ ok: false as const }));
    render(
      <CrewSection
        {...props}
        staff={[staffMember("staff-1", "Marisol Vega"), staffMember("staff-2", "Ana Cruz")]}
        crewIds={["staff-1"]}
        updateCrewAction={updateCrewAction}
        copy={COPY}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Assign crew" }), "staff-2");

    expect(await screen.findByText("Couldn’t save that change.")).toBeInTheDocument();
    expect(screen.queryByText(/cannot be on both/)).toBeNull();
  });
});
