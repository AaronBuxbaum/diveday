// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FIGURE_CLASS, LEAD_TITLE_CLASS } from "@/components/ui/typography";
import type { TripPrep } from "@/db/trips-prep";
import { diveRecencyText } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  buildDivePrepChecklist,
  type PrepDiver,
  type PrepGrouping,
  type RentalFit,
} from "@/lib/dive-prep";
import type { SupportNeeds } from "@/lib/support-needs";
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
function fit(overrides: Partial<RentalFit> = {}): RentalFit {
  return {
    rentsBcd: false,
    rentsRegulator: false,
    rentsWetsuit: false,
    rentsMaskFins: false,
    rentsWeights: false,
    rentsDiveComputer: false,
    rentsGopro: false,
    rentsDrysuit: false,
    rentsHoodGloves: false,
    rentsTorch: false,
    rentsSmb: false,
    bcdSize: null,
    wetsuitSize: null,
    drysuitSize: null,
    bootSize: null,
    finSize: null,
    weightPreference: null,
    needsStaffFitAt: null,
    needsStaffFitNote: null,
    fitStatedAt: STATED,
    ...overrides,
  };
}

const LIFT_AND_BOARDING: SupportNeeds = {
  supportDiversNeeded: null,
  supportDiversProvidedBy: null,
  needsBoardingAssistance: true,
  needsWaterLift: true,
  briefingInSign: false,
  briefingInWriting: false,
  briefingAloud: false,
  briefingBySignals: false,
  equipmentAdaptation: null,
  divesWithName: null,
  statedAt: STATED,
};

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
 * partial fit, a never-asked diver, a hands-on fit, a support arrangement, a
 * hotel pickup, a shared rental line, a diver dry for five years and an
 * assigned unit. The geometry below is about how each of those is drawn, so
 * each one has to be on the page.
 */
function everyPanelPrep(): TripPrep {
  const checklist = buildDivePrepChecklist({
    divers: [
      diver(1, "Carmen Ruiz", {
        fit: fit({
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
        fit: fit({
          rentsBcd: true,
          bcdSize: "XL",
          needsStaffFitAt: STATED,
          needsStaffFitNote: "No XL BCD left",
        }),
      }),
      // BCD L beside Carmen, so one rental line is for two divers; no weight
      // stated, so the partial list has a row.
      diver(3, "Grace Mensah", {
        fit: fit({ rentsBcd: true, bcdSize: "L", rentsWeights: true }),
      }),
      diver(4, "Theo Lindqvist"),
      diver(5, "Nadia Petrov", { wantsNitrox: true, supportNeeds: LIFT_AND_BOARDING }),
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
        hotelPickupLocation: "Harbour Inn",
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
          { reservationId: "r1", kind: "bcd", size: "L", label: "BCD #2", checkedOutAt: null },
        ] as never,
        wanted: [],
        handedOver: false,
      },
    ],
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
 * **How the packing list is drawn** (docs/design/pixel-craft.md). jsdom has no
 * layout, so each case pins the classes whose arithmetic the pixel probe
 * measured wrong; the probe re-measures the pixels.
 */
describe("the packing list's geometry", () => {
  it("stacks its sections at the gap its page asks for, never a margin each (K-487)", () => {
    const { container } = renderPrep(everyPanelPrep(), { notice: "gear-assigned" });
    const stack = container.firstElementChild;
    expect(stack).toHaveClass(STACK);
    // Tanks, nitrox, sizes, staff fit, support, pickups, kit, banner, assignments.
    expect(stack?.children.length).toBe(9);
    for (const section of stack?.children ?? []) {
      expect(tokens(section).filter((token) => /^mt-/.test(token))).toEqual([]);
    }
  });

  it("titles every section at the one size a card's own title has (K-151)", () => {
    const { container } = renderPrep(everyPanelPrep(), { notice: "gear-assigned" });
    const headings = container.querySelectorAll("h2");
    // Tanks, nitrox, sizes, staff fit, support, pickups, kit, assignments.
    expect(headings).toHaveLength(8);
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
});
