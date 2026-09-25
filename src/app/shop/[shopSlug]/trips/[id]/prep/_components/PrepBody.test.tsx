// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripPrep } from "@/db/trips-prep";
import { staffTranslator } from "@/i18n/staff-messages";
import { buildDivePrepChecklist } from "@/lib/dive-prep";
import { PrepBody } from "./PrepBody";

afterEach(cleanup);

const t = staffTranslator("en-US");

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
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
