// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FIGURE_CLASS, LEAD_TITLE_CLASS } from "@/components/ui/typography";
import type { TripPrep } from "@/db/trips";
import { diveRecencyText } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  buildDivePrepChecklist,
  type PrepDiver,
  type PrepGrouping,
  type RentalFit,
} from "@/lib/dive-prep";
import type { GearServiceState } from "@/lib/gear";
import { rendersFlush } from "@/test/button-flush";
import { PrepBody } from "./PrepBody";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** The stack gap both callers pass: a page's sections sit `space-y-10` apart. */
const STACK = "space-y-10";

/**
 * Two divers and a guide, so the packing half has something real to say: with
 * an empty roster both branches render the same nothing and the cancelled case
 * below would pass for the wrong reason.
 */
function prepFor(): TripPrep {
  const checklist = buildDivePrepChecklist({
    divers: [
      {
        bookingId: "b1",
        personId: "p1",
        fullName: "Carmen Ruiz",
        fit: {
          bcdSize: "L",
          wetsuitSize: "L",
          bootSize: "10",
          weightKg: 9,
          rentsBcd: true,
          rentsWetsuit: true,
        } as never,
        wantsNitrox: false,
        hasVerifiedNitroxCard: false,
        lastDivedBand: null,
      },
      {
        bookingId: "b2",
        personId: "p2",
        fullName: "Theo Lindqvist",
        fit: null,
        wantsNitrox: false,
        hasVerifiedNitroxCard: false,
        lastDivedBand: null,
      },
    ],
    plannedDives: 2,
    divingCrew: ["Keiko Tanaka"],
  });
  return {
    trip: { id: "t1", capacity: 12, booked: 2 } as TripPrep["trip"],
    checklist,
    hotelPickups: [],
    gearFleetTotal: 0,
    freeByKind: new Map(),
    loadOut: null,
    assignmentRows: [],
    proposals: new Map(),
  };
}

function renderBody(cancelled: boolean) {
  return render(
    <PrepBody
      prep={prepFor()}
      t={t}
      locale="en-US"
      shopSlug="blue-mantis"
      tripId="t1"
      rentalItems={["bcd", "wetsuit", "boots", "weights", "regulator", "mask_fins"]}
      notice={undefined}
      grouping="item"
      groupPath="/shop/blue-mantis/trips/t1"
      cancelled={cancelled}
      className={STACK}
    />,
  );
}

describe("PrepBody", () => {
  it("states where the tank total comes from, beside the total", () => {
    // The two facts a crew argues about, and the reason this line exists at
    // all: `/prep`'s page header used to carry it and the departure page has
    // no such header, so "6" stood over a roster of two with nothing on
    // screen saying the number is per *dive* and that the diving crew's own
    // tanks are in it (dive-domain review 20260920).
    renderBody(false);
    const derivation = screen.getByText(/one tank per diver per dive/);
    expect(derivation.textContent).toContain("2 divers");
    expect(derivation.textContent).toContain("1 diving crew member");
    expect(derivation.textContent).toContain("2 dives");
    // (2 divers + 1 diving crew) × 2 dives — the arithmetic that sentence names.
    expect(screen.getAllByText("6").length).toBeGreaterThan(0);
  });

  it("packs nothing on a departure that is not going, and says so", () => {
    // A blow-out cancels the *trip* and leaves every booking active, so every
    // count below still computes and every one of them is an instruction
    // about a check-in that is not happening. The tank tiles are the
    // dangerous half: a staffer working down a three-boat Saturday reads a
    // total long after the Cancelled badge has scrolled off the top.
    renderBody(true);
    expect(screen.getByText(/nothing to pack/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tanks" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Rental kit" })).toBeNull();
    expect(screen.queryByText(/one tank per diver per dive/)).toBeNull();
  });

  it("still packs on a departure that is going", () => {
    // The other half of the pair: without it the test above would pass over a
    // component that had stopped rendering anything at all.
    renderBody(false);
    expect(screen.getByRole("heading", { name: "Tanks" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rental kit" })).toBeTruthy();
  });

  it("points its grouping switch at the page it is rendering on", () => {
    // The switch is a state toggle, not a navigation: on the departure page it
    // must not jump the reader to `/prep`, which is the same list on a page
    // that is only the list.
    renderBody(false);
    const byDiver = screen.getByRole("link", { name: "By diver" });
    expect(byDiver.getAttribute("href")).toBe("/shop/blue-mantis/trips/t1?group=diver");
  });
});

/**
 * The departure page wraps this body in its `#packing-list` anchor and passes
 * no `emptyState`: the roster directly above already says the boat is empty.
 * On a departure nobody is booked on, the body must therefore render no node
 * at all, which is what lets that wrapper's `empty:hidden` take back the 40px
 * it would otherwise hold open (the pixel probe's phantom gap on the
 * trip-repeating captures, where the wrapper measured 0px tall).
 */
describe("an empty departure on the departure page", () => {
  it("renders no node at all when nobody is aboard and the page passes no emptyState", () => {
    const empty = prepFor();
    empty.checklist = buildDivePrepChecklist({ divers: [], plannedDives: 2, divingCrew: [] });
    const { container } = render(
      <PrepBody
        prep={empty}
        t={t}
        locale="en-US"
        shopSlug="blue-mantis"
        tripId="t1"
        rentalItems={["bcd", "wetsuit"]}
        notice={undefined}
        grouping="item"
        groupPath="/shop/blue-mantis/trips/t1"
        cancelled={false}
        className={STACK}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

const STATED = new Date("2026-09-01T00:00:00Z");

/** A stated fit that rents nothing until an override says it does. */
function statedFit(overrides: Partial<RentalFit> = {}): RentalFit {
  return {
    rentsBcd: false,
    rentsRegulator: false,
    rentsWetsuit: false,
    rentsMaskFins: false,
    rentsWeights: false,
    rentsDiveComputer: false,
    rentsGopro: false,
    rentsDrysuit: false,
    rentsHood: false,
    rentsGloves: false,
    rentsTorch: false,
    rentsSmb: false,
    bcdSize: null,
    wetsuitSize: null,
    drysuitSize: null,
    hoodSize: null,
    gloveSize: null,
    bootSize: null,
    finSize: null,
    weightPreference: null,
    divesDry: false,
    needsStaffFitAt: null,
    needsStaffFitNote: null,
    fitStatedAt: STATED,
    ...overrides,
  };
}

function diver(n: number, fullName: string, rest: Partial<PrepDiver> = {}): PrepDiver {
  return {
    bookingId: `b${n}`,
    personId: `p${n}`,
    fullName,
    fit: null,
    wantsNitrox: false,
    hasVerifiedNitroxCard: false,
    lastDivedBand: null,
    ...rest,
  };
}

/**
 * **A departure that opens every panel the list has**: a nitrox blocker, a
 * partial fit, a never-asked diver, a hands-on fit, a hotel pickup, a shared rental line, a diver dry for five years and an
 * assigned unit. The geometry below is about how each of those is drawn, so
 * each one has to be on the page.
 */
function everyPanelPrep(): TripPrep {
  const checklist = buildDivePrepChecklist({
    divers: [
      diver(1, "Carmen Ruiz", {
        fit: statedFit({
          rentsBcd: true,
          bcdSize: "L",
          rentsWetsuit: true,
          wetsuitSize: "L",
          bootSize: "10",
          rentsRegulator: true,
        }),
        lastDivedBand: "over_five_years",
      }),
      diver(2, "Sam Whitfield", {
        fit: statedFit({
          rentsBcd: true,
          bcdSize: "XL",
          needsStaffFitAt: STATED,
          needsStaffFitNote: "No XL BCD left",
        }),
      }),
      // BCD L beside Carmen, so one rental line is for two divers; no weight
      // stated, so the partial list has a row.
      diver(3, "Grace Mensah", {
        fit: statedFit({ rentsBcd: true, bcdSize: "L", rentsWeights: true }),
      }),
      diver(4, "Theo Lindqvist"),
      diver(5, "Nadia Petrov", { wantsNitrox: true }),
    ],
    plannedDives: 2,
    divingCrew: ["Keiko Tanaka"],
    now: new Date("2026-09-26T12:00:00Z"),
  });
  return {
    trip: { id: "t1", capacity: 12, booked: 5 } as TripPrep["trip"],
    checklist,
    hotelPickups: [
      {
        bookingId: "b1",
        diverName: "Carmen Ruiz",
        hotelPickupLocation: "Harbor Inn",
        pickupTime: "07:15",
      },
    ],
    gearFleetTotal: 4,
    freeByKind: new Map(),
    loadOut: { units: 1, divers: 1, stillToPick: 0, serviceFlagged: 0 },
    assignmentRows: [
      {
        diver: { bookingId: "b1", fullName: "Carmen Ruiz" } as never,
        assigned: [
          {
            reservationId: "r1",
            kind: "bcd",
            size: "L",
            label: "BCD #2",
            checkedOutAt: null,
            status: "in_service",
            serviceNote: null,
            serviceState: { state: "no_clock" },
            serviceConcern: false,
          },
        ] as never,
        wanted: [],
        handedOver: false,
        counterHeld: [],
      },
    ],
    proposals: new Map(),
  };
}

function renderPrep(
  prep: TripPrep,
  { grouping = "item", notice }: { grouping?: PrepGrouping; notice?: string } = {},
) {
  return render(
    <PrepBody
      prep={prep}
      t={t}
      locale="en-US"
      shopSlug="blue-mantis"
      tripId="t1"
      rentalItems={["bcd", "wetsuit", "boots", "weights", "regulator", "mask_fins"]}
      notice={notice}
      grouping={grouping}
      groupPath="/shop/blue-mantis/trips/t1"
      cancelled={false}
      className={STACK}
    />,
  );
}

/** Every link on the list that opens a diver's record. */
function diverLinks(root: HTMLElement): HTMLElement[] {
  return within(root)
    .getAllByRole("link")
    .filter((link) => /\/divers\/p\d/.test(link.getAttribute("href") ?? ""));
}

/** The element whose own text is exactly `text`, for finding a panel by its words. */
function byText(root: HTMLElement, text: string): HTMLElement {
  return within(root).getByText(text, { exact: true });
}

/** A class list as tokens, so `mt-4` never matches inside `-mt-4` or `sm:mt-4`. */
function tokens(element: Element | null | undefined): string[] {
  return (element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * A spacing utility's length in px on Tailwind's 4px scale, read off the
 * element's own tokens: `gap-y-6` is 24, `-my-2.5` is 10, and an element with
 * no such token is 0.
 */
function spacingPx(element: Element | null | undefined, utility: string): number {
  for (const token of tokens(element)) {
    if (!token.startsWith(`${utility}-`)) continue;
    const step = Number(token.slice(utility.length + 1));
    if (Number.isFinite(step)) return step * 4;
  }
  return 0;
}

/**
 * **How the packing list is drawn** (docs/design/pixel-craft.md). jsdom has no
 * layout, so each case pins the classes whose arithmetic the pixel probe
 * measured wrong; the probe re-measures the pixels.
 */
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
          counterHeld: [],
        },
        {
          diver: { bookingId: "b2", fullName: "Theo Lindqvist" } as never,
          assigned: [] as never,
          wanted: [{ kind: "bcd", size: "XL" }],
          handedOver: false,
          counterHeld: [],
        },
      ],
      proposals: new Map([["b1:bcd", proposed]]),
    };
  }

  it("says the proposed unit in words, and keeps the picker open only where there is none", () => {
    renderPrep(withProposal());
    expect(screen.getByText("Proposed: BCD #3 · L")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    // Theo's XL has no exact unit, so his row is the one select on the tab.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("says a proposed unit's service is coming due, in the words the picker uses", () => {
    renderPrep(
      withProposal({
        proposedState: { state: "due_soon", kind: "service", nextDueOn: "2026-10-20", daysLeft: 9 },
      }),
    );
    expect(
      screen.getByText(`Proposed: BCD #3 · L · ${t("gear.prep.optionServiceDueSoon")}`),
    ).toBeInTheDocument();
  });

  it("labels a unit with an unanswered service concern in the picker, as it labels a lapsed clock", () => {
    renderPrep(withProposal({ otherConcern: true }));
    expect(
      screen.getByRole("option", {
        name: `BCD #4 · S · ${t("gear.prep.optionServiceConcern")}`,
      }),
    ).toBeInTheDocument();
  });

  it("offers every proposal in one tap", () => {
    renderPrep(withProposal());
    expect(screen.getByRole("button", { name: "Assign the proposed unit" })).toBeInTheDocument();
  });

  it("proposes nothing on a departure that is not going", () => {
    render(
      <PrepBody
        prep={withProposal()}
        t={t}
        locale="en-US"
        shopSlug="blue-mantis"
        tripId="t1"
        rentalItems={["bcd"]}
        notice={undefined}
        grouping="item"
        groupPath="/shop/blue-mantis/trips/t1"
        cancelled
        className={STACK}
      />,
    );
    expect(screen.queryByText("Proposed: BCD #3 · L")).toBeNull();
    expect(screen.queryByRole("button", { name: /proposed/ })).toBeNull();
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
          counterHeld: [],
        },
      ],
    } satisfies TripPrep;
  }

  it("says an open service concern beside the unit", () => {
    renderPrep(withAssigned({ serviceState: { state: "no_clock" }, serviceConcern: true }));
    expect(screen.getByText("Reg #2")).toBeInTheDocument();
    expect(screen.getByText(t("gear.prep.optionServiceConcern"))).toBeInTheDocument();
  });

  it("says a lapsed clock and a concern together, in the order the picker says them", () => {
    renderPrep(
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
    renderPrep(
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
    renderPrep(
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
    renderPrep(withAssigned({ serviceState: { state: "no_clock" }, serviceConcern: false }));
    expect(screen.queryByText(t("gear.prep.optionServiceConcern"))).toBeNull();
    expect(screen.queryByText(t("gear.prep.optionServiceOverdue"))).toBeNull();
  });

  it("counts it on the cart line in words that fit a concern as well as a clock", () => {
    renderPrep(withAssigned({ serviceState: { state: "no_clock" }, serviceConcern: true }));
    expect(screen.getByText(/1 unit needs service/)).toBeInTheDocument();
  });
});

describe("the packing list's geometry", () => {
  it("stacks its sections at the gap its page asks for, never a margin each (K-487)", () => {
    const { container } = renderPrep(everyPanelPrep(), { notice: "gear-released" });
    const stack = container.firstElementChild;
    expect(stack).toHaveClass(STACK);
    // Tanks, nitrox, sizes, staff fit, pickups, kit, banner, assignments.
    expect(stack?.children.length).toBe(8);
    for (const section of stack?.children ?? []) {
      expect(tokens(section).filter((token) => /^mt-/.test(token))).toEqual([]);
    }
  });

  it("gives every diver's name that stands on its own line a 44px target, and keeps the line (K-146)", () => {
    const { container } = renderPrep(everyPanelPrep());
    const lead = byText(container, t("tripPrep.missingSizesNobodyAskedLead"));
    const neverAsked = within(lead.nextElementSibling as HTMLElement).getAllByRole("link");
    expect(neverAsked.map((link) => link.textContent)).toEqual(["Theo Lindqvist", "Nadia Petrov"]);
    for (const link of neverAsked) {
      // The 44px floor, and the (44 − 20) / 2 handed back above and below, so
      // the 20px line the name sits on does not grow to 44.
      expect(tokens(link)).toEqual(expect.arrayContaining(["inline-flex", "min-h-11", "-my-3"]));
    }
  });

  it("sets the never-asked run's rows a whole target apart, so a tap lands on the name it covers (K-146)", () => {
    const { container } = renderPrep(everyPanelPrep());
    const lead = byText(container, t("tripPrep.missingSizesNobodyAskedLead"));
    const run = lead.nextElementSibling as HTMLElement;
    const rowGap = spacingPx(run, "gap-y");
    for (const link of within(run).getAllByRole("link")) {
      // Each target reaches its give-back above and below its line, and the
      // next row's reaches as far up. With the rows closer than twice that, a
      // wrapped row's targets cover the names above them, and the later one
      // in the DOM wins the tap: a diver's record opens for the name above.
      expect(rowGap, link.textContent ?? "").toBeGreaterThanOrEqual(2 * spacingPx(link, "-my"));
    }
  });

  it("hands back only the height its own padding adds, so a name that wraps keeps its lines (K-146)", () => {
    const byItem = renderPrep(everyPanelPrep()).container;
    const neverAsked = within(
      byText(byItem, t("tripPrep.missingSizesNobodyAskedLead")).nextElementSibling as HTMLElement,
    ).getAllByRole("link");
    const byDiver = renderPrep(everyPanelPrep(), { grouping: "diver" }).container;
    const carmen = diverLinks(byDiver).filter((link) => link.textContent === "Carmen Ruiz");
    expect(carmen).toHaveLength(2);
    for (const link of [...neverAsked, ...carmen]) {
      // A 44px floor with a fixed give-back is right only for a name on one
      // line: wrapped, the box outgrows the floor, the margin still hands back
      // the same, and the second line hangs over the dive-recency note under
      // it. Padding the box by what the margin hands back keeps the margin box
      // exactly the name's own lines, however many there are.
      const giveBack = spacingPx(link, "-my");
      expect(giveBack, link.textContent ?? "").toBeGreaterThan(0);
      expect(spacingPx(link, "py"), link.textContent ?? "").toBe(giveBack);
    }
  });

  it("gives the phone card's name a 44px target on its 24px line, and the table's row the RowLink (K-146)", () => {
    const { container } = renderPrep(everyPanelPrep(), { grouping: "diver" });
    const carmen = diverLinks(container).filter((link) => link.textContent === "Carmen Ruiz");
    expect(carmen).toHaveLength(2);
    const [card, row] = carmen;
    expect(tokens(card)).toEqual(expect.arrayContaining(["inline-flex", "min-h-11", "-my-2.5"]));
    // The table's first cell is the row's one way in: `RowLink`'s overlay,
    // positioned against `Tr`'s `relative`, never against the page.
    expect(tokens(row)).toEqual(expect.arrayContaining(["min-h-11", "after:absolute", "-my-3"]));
    expect(row.closest("tr")).toHaveClass("relative");
  });

  it("starts both values of a kit card at one x, however long the names run (K-147)", () => {
    const { container } = renderPrep(everyPanelPrep());
    const cards = container.querySelectorAll("ul.sm\\:hidden > li dl");
    expect(cards.length).toBeGreaterThan(0);
    for (const dl of cards) {
      expect(tokens(dl)).toEqual(
        expect.arrayContaining(["grid", "grid-cols-[auto_minmax(0,1fr)]", "gap-x-2"]),
      );
      expect(dl.children).toHaveLength(2);
      for (const pair of dl.children) {
        expect(tokens(pair)).toEqual(
          expect.arrayContaining(["col-span-2", "grid", "grid-cols-subgrid"]),
        );
      }
    }
  });

  it("pins the quantity column narrow in both tables, so the names get the room (K-148)", () => {
    for (const grouping of ["item", "diver"] as const) {
      const { container, unmount } = renderPrep(everyPanelPrep(), { grouping });
      const qty = within(container)
        .getAllByRole("columnheader")
        .filter((th) => th.textContent === t("tripPrep.qtyColumn"));
      expect(qty, grouping).toHaveLength(1);
      expect(qty[0], grouping).toHaveClass("w-32");
      unmount();
    }
    // The by-item table's short Item column is pinned too, so Size and For
    // share what is left: with three unnamed columns splitting it, For held
    // two names a line at 1280 and the fifth fell alone onto a third.
    const { container } = renderPrep(everyPanelPrep());
    const item = within(container).getByRole("columnheader", { name: t("tripPrep.itemColumn") });
    expect(item).toHaveClass("w-40");
    for (const unpinned of [t("tripPrep.sizeColumn"), t("tripPrep.forColumn")]) {
      const header = within(container).getByRole("columnheader", { name: unpinned });
      expect(
        tokens(header).filter((token) => /^w-/.test(token)),
        unpinned,
      ).toEqual([]);
    }
  });

  it("hangs a kit piece's wrapped detail under the detail, not under the piece (K-148)", () => {
    const { container } = renderPrep(everyPanelPrep(), { grouping: "diver" });
    const row = diverLinks(container)
      .filter((link) => link.textContent === "Carmen Ruiz")[1]
      .closest("tr") as HTMLElement;
    const pieces = row.querySelectorAll("td:nth-child(2) li");
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece).toHaveClass("flex");
      // The piece and its detail are two boxes; no bare text between them.
      for (const node of piece.childNodes) expect(node.nodeType).toBe(Node.ELEMENT_NODE);
    }
  });

  it("sets each card's count on its title's baseline (K-149)", () => {
    for (const grouping of ["item", "diver"] as const) {
      const { container, unmount } = renderPrep(everyPanelPrep(), { grouping });
      const counts = [...container.querySelectorAll("ul.sm\\:hidden > li p")].filter((p) =>
        tokens(p).includes(FIGURE_CLASS.split(" ")[0]),
      );
      expect(counts.length, grouping).toBeGreaterThan(0);
      for (const count of counts) {
        expect(tokens(count.parentElement), grouping).toContain("items-baseline");
        expect(tokens(count.parentElement), grouping).not.toContain("items-start");
      }
      unmount();
    }
  });

  it("titles every section at the one size a card's own title has (K-151)", () => {
    const { container } = renderPrep(everyPanelPrep(), { notice: "gear-released" });
    const headings = container.querySelectorAll("h2");
    // Tanks, nitrox, sizes, staff fit, pickups, kit, assignments.
    expect(headings).toHaveLength(7);
    for (const heading of headings) {
      expect(tokens(heading), heading.textContent ?? "").toEqual(
        expect.arrayContaining(LEAD_TITLE_CLASS.split(" ")),
      );
      expect(tokens(heading), heading.textContent ?? "").not.toContain("text-lg");
    }
  });

  it("hangs a bullet's wrapped line under its words, not under the bullet (K-154)", () => {
    const { container } = renderPrep(everyPanelPrep());
    const bullets = within(container).getAllByText("•", { exact: true });
    // The nitrox blocker, the partial fit and the hands-on fit.
    expect(bullets).toHaveLength(3);
    for (const bullet of bullets) {
      expect(bullet.tagName).toBe("SPAN");
      expect(bullet).toHaveAttribute("aria-hidden", "true");
      const item = bullet.parentElement as HTMLElement;
      expect(item.tagName).toBe("LI");
      expect(tokens(item)).toEqual(expect.arrayContaining(["flex", "gap-1.5"]));
      // The bullet and the words are the item's only two boxes.
      expect(item.childNodes).toHaveLength(2);
      expect(item.lastChild?.nodeName).toBe("SPAN");
    }
  });

  it("opens a tone panel's list at the gap a card opens its body (K-173)", () => {
    const { container } = renderPrep(everyPanelPrep());
    for (const key of ["tripPrep.nitroxBlockedHeading", "tripPrep.staffFitHeading"] as const) {
      const panel = byText(container, t(key)).closest("section") as HTMLElement;
      const list = panel.querySelector("ul");
      expect(tokens(list), key).toContain("mt-4");
      expect(tokens(list), key).not.toContain("mt-2");
    }
  });

  it("holds no empty list open above the never-asked names (K-184)", () => {
    // Only divers nobody asked: the partial list has nothing to say.
    const prep = everyPanelPrep();
    prep.checklist = buildDivePrepChecklist({
      divers: [diver(4, "Theo Lindqvist"), diver(6, "Ana Costa")],
      plannedDives: 2,
      now: new Date("2026-09-26T12:00:00Z"),
    });
    const { container } = renderPrep(prep);
    const lead = byText(container, t("tripPrep.missingSizesNobodyAskedLead"));
    const card = lead.closest("section") as HTMLElement;
    for (const list of card.querySelectorAll("ul")) {
      expect(list.children.length).toBeGreaterThan(0);
    }
    // The never-asked block is the body's first child, with no margin of its own.
    const block = lead.parentElement as HTMLElement;
    expect(block.previousElementSibling).toBeNull();
    expect(tokens(block).filter((token) => /^mt-/.test(token))).toEqual([]);
  });

  it("keeps the partial list and the never-asked block one gap apart when both are there (K-184)", () => {
    const { container } = renderPrep(everyPanelPrep());
    const block = byText(container, t("tripPrep.missingSizesNobodyAskedLead"))
      .parentElement as HTMLElement;
    expect(block.previousElementSibling?.tagName).toBe("UL");
    expect(tokens(block.parentElement)).toEqual(
      expect.arrayContaining(["flex", "flex-col", "gap-3"]),
    );
    expect(tokens(block).filter((token) => /^mt-/.test(token))).toEqual([]);
  });

  it("keeps a diver's header row to their name's line when a ticket link sits beside it (K-280)", () => {
    const { container } = renderPrep(everyPanelPrep());
    const ticket = within(container).getByRole("link", { name: t("gear.prep.ticketDoor") });
    // (44 − 24) / 2 handed back, and the ring drawn inside the clipping card.
    expect(tokens(ticket)).toEqual(
      expect.arrayContaining(["-my-2.5", "focus-visible:focus-ring-inset"]),
    );
    // `flush` asked of `buttonClass`, not spelled as its tokens (K-83).
    expect(rendersFlush(ticket, "ghost", "sm")).toBe(true);
  });

  it("sets the dive-recency mark on the note's first line, not its middle (K-281)", () => {
    const { container } = renderPrep(everyPanelPrep(), { grouping: "diver" });
    const words = diveRecencyText(t, "over_five_years") ?? "";
    const notes = [...container.querySelectorAll("span")].filter(
      (span) => span.textContent === words && span.children.length > 0,
    );
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(tokens(note)).toEqual(expect.arrayContaining(["flex", "items-start", "gap-2"]));
      expect(tokens(note)).not.toContain("items-center");
    }
  });

  it("breaks a shared rental line between two names, and a name only where it cannot fit whole (K-353)", () => {
    const { container } = renderPrep(everyPanelPrep());
    // Carmen and Grace share the BCD L line: drawn as a phone card's For list
    // and as the table's For cell.
    const shared = [...container.querySelectorAll("dd, td")].filter(
      (cell) => cell.textContent === "Carmen Ruiz, Grace Mensah",
    );
    expect(shared).toHaveLength(2);
    for (const cell of shared) {
      const names = [...cell.children];
      expect(names.map((name) => name.textContent)).toEqual(["Carmen Ruiz,", "Grace Mensah"]);
      for (const name of names) {
        // Its own box: it moves to the next line whole, and wraps inside
        // itself only when it is wider than the column. Unbreakable, a name
        // wider than a clipping cell was cut off without a mark.
        expect(name.tagName).toBe("SPAN");
        expect(tokens(name)).toContain("inline-block");
        expect(tokens(name)).not.toContain("whitespace-nowrap");
      }
      // The comma travels with the name before it; the only break between two
      // names is the bare space.
      const between = [...cell.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
      expect(between.map((node) => node.textContent)).toEqual([" "]);
    }
  });

  it("floors the by-item table at a width a 768px tablet holds without scrolling (K-506)", () => {
    const { container } = renderPrep(everyPanelPrep());
    const byItem = [...container.querySelectorAll("table")].find((table) =>
      within(table).queryByRole("columnheader", { name: t("tripPrep.itemColumn") }),
    );
    expect(byItem).toHaveClass("min-w-[40rem]");
    expect(byItem).not.toHaveClass("min-w-[45rem]");
  });

  it("heads the hotel pickups table with the one row THead draws", () => {
    // `THead` wraps its cells in its own `<tr>`; a second one inside it makes
    // a row in a row, which a browser draws as a table squeezed into the
    // first column, under a header row that has lost its column voice.
    const { container } = renderPrep(everyPanelPrep());
    const hotel = within(container).getByRole("columnheader", {
      name: t("tripPrep.pickupHotelColumn"),
    });
    const head = hotel.closest("thead") as HTMLElement;
    expect(head.querySelectorAll("tr")).toHaveLength(1);
    expect(hotel.parentElement?.parentElement).toBe(head);
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
    const { container } = renderPrep({
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
    const { container } = renderPrep(everyPanelPrep());
    expect(within(container).queryByText(/on a counter rental/)).toBeNull();
  });
});
