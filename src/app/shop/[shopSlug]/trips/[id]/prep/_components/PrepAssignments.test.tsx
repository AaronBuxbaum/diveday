// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripPrep } from "@/db/trips";
import type { GearServiceState } from "@/lib/gear";
import { rendersFlush } from "@/test/button-flush";
import { PrepAssignments } from "./PrepAssignments";
import { everyPanelPrep, prepFor, t, tokens, viewOf } from "./prep-test-fixtures";

afterEach(cleanup);

function renderAssignments(
  prep: TripPrep,
  {
    cancelled = false,
    sailed = false,
    home = false,
  }: { cancelled?: boolean; sailed?: boolean; home?: boolean } = {},
) {
  return render(<PrepAssignments view={viewOf(prep, { cancelled, sailed, home })} />);
}

/**
 * **A proposal for every piece the register can answer** (UX audit
 * 2026-10-07, item 9): a proposed row says which unit in words and offers
 * Assign and Change, never a select; a row with no proposal keeps its picker
 * open; and the section offers every proposal in one tap.
 */
describe("proposed units on the Gear tab", () => {
  function withProposal(
    options: { proposedState?: GearServiceState; otherConcern?: boolean } = {},
  ): TripPrep {
    const base = prepFor();
    const unit = (id: string, label: string, size: string | null) => ({
      id,
      kind: "bcd" as const,
      label,
      size,
      serviceState: { state: "no_clock" } as GearServiceState,
      serviceConcern: false,
      nitroxDesignated: null,
      thicknessMm: null,
      o2Clean: null,
    });
    const proposed = {
      ...unit("u3", "BCD #3", "L"),
      ...(options.proposedState ? { serviceState: options.proposedState } : {}),
    };
    const other = { ...unit("u4", "BCD #4", "S"), serviceConcern: options.otherConcern ?? false };
    return {
      ...base,
      gearFleetTotal: 4,
      loadOut: { units: 0, divers: 2, stillToPick: 2, serviceFlagged: 0 },
      freeByKind: new Map([["bcd", [proposed, other]]]),
      assignmentRows: [
        {
          diver: { bookingId: "b1", fullName: "Carmen Ruiz" } as never,
          assigned: [] as never,
          wanted: [{ kind: "bcd", size: "L" }],
          handedOver: false,
          needsStaffFit: null,
          counterHeld: [],
        },
        {
          diver: { bookingId: "b2", fullName: "Theo Lindqvist" } as never,
          assigned: [] as never,
          wanted: [{ kind: "bcd", size: "XL" }],
          handedOver: false,
          needsStaffFit: null,
          counterHeld: [],
        },
      ],
      proposals: new Map([["b1:bcd", proposed]]),
    };
  }

  it("says the proposed unit in words, and keeps the picker open only where there is none", () => {
    renderAssignments(withProposal());
    expect(screen.getByText("Proposed: BCD #3 · L")).toBeInTheDocument();
    // One text button per proposed row, no per-row Assign (A10).
    expect(screen.queryByRole("button", { name: "Assign" })).toBeNull();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    // Theo's XL has no exact unit, so his row is the one select on the tab.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("says a proposed unit's service is coming due, in the words the picker uses", () => {
    renderAssignments(
      withProposal({
        proposedState: { state: "due_soon", kind: "service", nextDueOn: "2026-10-20", daysLeft: 9 },
      }),
    );
    expect(
      screen.getByText(`Proposed: BCD #3 · L · ${t("gear.prep.optionServiceDueSoon")}`),
    ).toBeInTheDocument();
  });

  it("labels a unit with an unanswered service concern in the picker, as it labels a lapsed clock", () => {
    renderAssignments(withProposal({ otherConcern: true }));
    expect(
      screen.getByRole("option", {
        name: `BCD #4 · S · ${t("gear.prep.optionServiceConcern")}`,
      }),
    ).toBeInTheDocument();
  });

  it("offers every proposal in one tap", () => {
    renderAssignments(withProposal());
    expect(screen.getByRole("button", { name: "Assign the proposed unit" })).toBeInTheDocument();
  });

  /**
   * **One number set** (visual review 2026-10-24, A10 and B54): the summary and
   * "Assign all" read one count, so what the button assigns is exactly the
   * proposals on screen, and what the summary says is still to pick is exactly
   * the open rows (each proposal and each picker).
   */
  it("counts the button and the summary from the rows on screen", () => {
    renderAssignments(withProposal());
    const proposed = screen.getAllByText(/^Proposed: /).length;
    const pickers = screen.getAllByRole("combobox").length;
    const summary = screen.getByText(/units? assigned/).textContent ?? "";
    const [, assigned, needed, missing] =
      summary.match(/^(\d+) of (\d+) units? assigned · (\d+) still to pick/) ?? [];
    expect(Number(missing)).toBe(proposed + pickers);
    expect(Number(needed)).toBe(Number(assigned) + Number(missing));
    const button = screen.getByRole("button", { name: /^Assign (the proposed unit|all \d+)/ });
    const n = button.textContent?.match(/\d+/)?.[0] ?? "1";
    expect(Number(n)).toBe(proposed);
  });

  /**
   * **A boat at sea picks nothing more** (fourth review, item 16): "2 pieces
   * still to pick" and "Assign all" are the dock's instructions.
   */
  it("asks for no picking once the boat has left the dock", () => {
    renderAssignments(withProposal(), { sailed: true });
    expect(screen.queryByText(/still to pick/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Assign the proposed unit" })).toBeNull();
  });

  it("proposes nothing on a departure that is not going", () => {
    renderAssignments(withProposal(), { cancelled: true });
    expect(screen.queryByText("Proposed: BCD #3 · L")).toBeNull();
    expect(screen.queryByRole("button", { name: /proposed/ })).toBeNull();
  });
});

/**
 * **A diver flagged for a staff fit keeps their pickers** (issue #2208). The
 * row says the diver needs a staff fit, offers a picker for each piece opened
 * on the placeholder, and proposes nothing.
 */
describe("a diver flagged for a staff fit on the Gear tab", () => {
  function flaggedPrep(): TripPrep {
    const base = prepFor();
    const unit = {
      id: "r1",
      kind: "regulator" as const,
      label: "Reg #1",
      size: null,
      serviceState: { state: "no_clock" } as GearServiceState,
      serviceConcern: false,
      nitroxDesignated: null,
      thicknessMm: null,
      o2Clean: null,
    };
    return {
      ...base,
      gearFleetTotal: 1,
      loadOut: { units: 0, divers: 1, stillToPick: 1, serviceFlagged: 0 },
      freeByKind: new Map([["regulator", [unit]]]),
      assignmentRows: [
        {
          diver: { bookingId: "b1", fullName: "Carmen Ruiz" } as never,
          assigned: [] as never,
          wanted: [{ kind: "regulator", size: null, sizeIsAStart: true }],
          needsStaffFit: { note: "No XL BCD left" },
          handedOver: false,
          counterHeld: [],
        },
      ],
      proposals: new Map(),
    };
  }

  it("says the diver needs a staff fit and opens each picker on the placeholder", () => {
    const { container } = renderAssignments(flaggedPrep());
    expect(
      within(container).getByText(
        t("shared.rentalFit.needsStaffFitWithNote", { note: "No XL BCD left" }),
      ),
    ).toBeTruthy();
    const [picker, ...others] = within(container).getAllByRole("combobox");
    expect(others).toHaveLength(0);
    expect((picker as HTMLSelectElement).value).toBe("");
    expect(within(container).getByRole("option", { name: "Reg #1" })).toBeTruthy();
    expect(within(container).queryByText(/^Proposed:/)).toBeNull();
    expect(within(container).queryByRole("button", { name: /proposed/ })).toBeNull();
  });

  it("says nothing of the kind on a row with no flag", () => {
    const prep = flaggedPrep();
    const [row] = prep.assignmentRows;
    if (!row) throw new Error("a row expected");
    const { container } = renderAssignments({
      ...prep,
      assignmentRows: [{ ...row, needsStaffFit: null }],
    });
    expect(within(container).queryByText(/Needs staff fit/)).toBeNull();
  });
});

/**
 * **An assigned unit keeps its care labels** (second dive-domain review of the
 * proposals). The picker said "service concern" or "service overdue" in the
 * option; the assigned line says it too, in the same words, and the cart line
 * counts it.
 */
describe("an assigned unit that needs care", () => {
  function withAssigned(unit: {
    serviceState: GearServiceState;
    serviceConcern: boolean;
    status?: "in_service" | "needs_service";
    serviceNote?: string | null;
  }) {
    const base = prepFor();
    return {
      ...base,
      gearFleetTotal: 4,
      loadOut: { units: 1, divers: 1, stillToPick: 0, serviceFlagged: 1 },
      assignmentRows: [
        {
          diver: { bookingId: "b1", fullName: "Carmen Ruiz" } as never,
          assigned: [
            {
              reservationId: "r1",
              gearItemId: "u2",
              bookingId: "b1",
              kind: "regulator",
              size: null,
              label: "Reg #2",
              reservedFrom: "2026-07-21",
              reservedUntil: "2026-07-21",
              checkedOutAt: null,
              status: "in_service",
              serviceNote: null,
              ...unit,
            },
          ] as never,
          wanted: [],
          handedOver: false,
          needsStaffFit: null,
          counterHeld: [],
        },
      ],
    } satisfies TripPrep;
  }

  it("says an open service concern beside the unit", () => {
    renderAssignments(withAssigned({ serviceState: { state: "no_clock" }, serviceConcern: true }));
    expect(screen.getByText("Reg #2")).toBeInTheDocument();
    expect(screen.getByText(t("gear.prep.optionServiceConcern"))).toBeInTheDocument();
  });

  it("says a lapsed clock and a concern together, in the order the picker says them", () => {
    renderAssignments(
      withAssigned({
        serviceState: {
          state: "overdue",
          kind: "service",
          nextDueOn: "2026-07-01",
          daysOverdue: 20,
        },
        serviceConcern: true,
      }),
    );
    expect(
      screen.getByText(
        `${t("gear.prep.optionServiceOverdue")} · ${t("gear.prep.optionServiceConcern")}`,
      ),
    ).toBeInTheDocument();
  });

  it("says a unit pulled out of service since it was assigned, with the technician's note", () => {
    renderAssignments(
      withAssigned({
        serviceState: { state: "no_clock" },
        serviceConcern: false,
        status: "needs_service",
        serviceNote: "Inflator sticks",
      }),
    );
    expect(
      screen.getByText(`${t("gear.status.needsService")} · Inflator sticks`),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 unit needs service/)).toBeInTheDocument();
  });

  it("says a pulled unit with no note in the status word alone", () => {
    renderAssignments(
      withAssigned({
        serviceState: { state: "no_clock" },
        serviceConcern: false,
        status: "needs_service",
        serviceNote: null,
      }),
    );
    expect(screen.getByText(t("gear.status.needsService"))).toBeInTheDocument();
  });

  it("says nothing more about a unit that needs nothing", () => {
    renderAssignments(withAssigned({ serviceState: { state: "no_clock" }, serviceConcern: false }));
    expect(screen.queryByText(t("gear.prep.optionServiceConcern"))).toBeNull();
    expect(screen.queryByText(t("gear.prep.optionServiceOverdue"))).toBeNull();
  });

  it("counts it on the cart line in words that fit a concern as well as a clock", () => {
    renderAssignments(withAssigned({ serviceState: { state: "no_clock" }, serviceConcern: true }));
    expect(screen.getByText(/1 unit needs service/)).toBeInTheDocument();
  });
});

/**
 * **How the packing list is drawn** (docs/design/pixel-craft.md). jsdom has no
 * layout, so each case pins the classes whose arithmetic the pixel probe
 * measured wrong; the probe re-measures the pixels.
 */
describe("the packing list's geometry", () => {
  it("keeps a diver's header row to their name's line when a ticket link sits beside it (K-280)", () => {
    const { container } = renderAssignments(everyPanelPrep());
    const ticket = within(container).getByRole("link", { name: t("gear.prep.ticketDoor") });
    // (44 − 24) / 2 handed back, and the ring drawn inside the clipping card.
    expect(tokens(ticket)).toEqual(
      expect.arrayContaining(["-my-2.5", "focus-visible:focus-ring-inset"]),
    );
    // `flush` asked of `buttonClass`, not spelled as its tokens (K-83).
    expect(rendersFlush(ticket, "ghost", "sm")).toBe(true);
  });
});

/**
 * **A diver already carrying the shop's kit off a counter rental** (dive-domain
 * review of PR #2256, item 4): their row says so, with the latest back-by date.
 */
describe("a diver holding a counter rental over the departure", () => {
  it("names the units and the latest back-by date on the diver's row", () => {
    const base = everyPanelPrep();
    const [first, ...rest] = base.assignmentRows;
    if (!first) throw new Error("a row expected");
    const { container } = renderAssignments({
      ...base,
      assignmentRows: [
        {
          ...first,
          counterHeld: [
            { label: "Reg #3", until: "2026-09-27" },
            { label: "Computer #2", until: "2026-09-28" },
          ],
        },
        ...rest,
      ],
    });
    expect(
      within(container).getByText(
        /^Has Reg #3 and Computer #2 on a counter rental until Sep\s28,\s2026$/,
      ),
    ).toBeTruthy();
  });

  it("says nothing on a row with no counter rental", () => {
    const { container } = renderAssignments(everyPanelPrep());
    expect(within(container).queryByText(/on a counter rental/)).toBeNull();
  });
});

/**
 * **One way home per unit** (fifth-loop ideas, item 5): once the boat is home,
 * "Back from the boat" asks per unit, so the per-diver set return and the
 * hand-over give way to it.
 */
describe("the set controls once the boat is home", () => {
  function outPrep(checkedOut: boolean): TripPrep {
    const base = everyPanelPrep();
    const [row] = base.assignmentRows;
    if (!row) throw new Error("fixture row missing");
    return {
      ...base,
      assignmentRows: [
        {
          ...row,
          handedOver: checkedOut,
          assigned: row.assigned.map((unit) => ({
            ...unit,
            checkedOutAt: checkedOut ? new Date("2026-09-01T11:00:00Z") : null,
          })),
        },
      ],
    };
  }

  it("offers the set return while the boat is out, and not once it is home", () => {
    renderAssignments(outPrep(true), { sailed: true });
    expect(screen.getByRole("button", { name: t("gear.prep.returnAllGood") })).toBeTruthy();
    cleanup();
    renderAssignments(outPrep(true), { sailed: true, home: true });
    expect(screen.queryByRole("button", { name: t("gear.prep.returnAllGood") })).toBeNull();
  });

  it("offers no hand-over once the boat is home", () => {
    renderAssignments(outPrep(false), { sailed: true, home: true });
    expect(screen.queryByRole("button", { name: t("gear.prep.handOver") })).toBeNull();
  });
});

/**
 * **A diver's kit as tiles, the diver's acts on the name's line** (Aaron,
 * 2026-10-23: the surface was "really ugly"). The hand-over sits beside the
 * name rather than under the last piece, and the kit list holds only pieces,
 * so the grid of tiles is never broken by a button between them.
 */
describe("the diver's row", () => {
  it("puts the hand-over on the name's line, outside the kit grid", () => {
    const { container } = renderAssignments(everyPanelPrep());
    const handOver = screen.getByRole("button", { name: t("gear.prep.handOver") });
    expect(handOver.closest("dl")).toBeNull();
    const name = within(container).getByText(
      everyPanelPrep().assignmentRows[0]?.diver.fullName ?? "",
    );
    expect(name.parentElement?.contains(handOver)).toBe(true);
  });

  it("lays the kit out as a grid of tiles from sm up", () => {
    const { container } = renderAssignments(everyPanelPrep());
    const grid = container.querySelector("dl");
    expect(grid?.className).toContain("sm:grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-3");
  });
});
