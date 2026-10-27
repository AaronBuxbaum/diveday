// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { buildDivePrepChecklist } from "@/lib/dive-prep";
import { PrepBody } from "./PrepBody";
import {
  byText,
  diverLinks,
  everyPanelPrep,
  heldPrep,
  prepFor,
  renderPrep,
  STACK,
  spacingPx,
  t,
  tokens,
  withSeats,
} from "./prep-test-fixtures";

/**
 * **The list as a whole**: what it draws on a cancelled or an empty departure,
 * how its sections stack, and the cases that cross two sections. Each
 * section's own contract sits in its sibling's test (`PrepTanks.test.tsx`,
 * `PrepKitList.test.tsx`, `PrepFitGaps.test.tsx`, `PrepPickups.test.tsx`,
 * `PrepAssignments.test.tsx`).
 */

afterEach(cleanup);

function renderBody(cancelled: boolean) {
  return render(
    <PrepBody
      prep={prepFor()}
      t={t}
      locale="en-US"
      shopSlug="blue-mantis"
      tripId="t1"
      rentalItems={["bcd", "wetsuit", "boots", "weights", "regulator", "fins"]}
      notice={undefined}
      grouping="item"
      groupPath="/shop/blue-mantis/trips/t1"
      cancelled={cancelled}
      className={STACK}
    />,
  );
}

describe("PrepBody", () => {
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

/**
 * Issue #2213. The crew loads one snorkel vest per snorkeler seat, said in the
 * rental kit section; a snorkel-only boat is not an empty one.
 */
describe("snorkel vests", () => {
  it("draws the prep for a snorkel-only boat rather than an empty state", () => {
    const { container } = renderPrep(withSeats(["snorkeler"]));
    expect(within(container).getByText("1 snorkel vest, one per snorkeler")).toBeTruthy();
  });
});

/**
 * **How the packing list is drawn** (docs/design/pixel-craft.md). jsdom has no
 * layout, so each case pins the classes whose arithmetic the pixel probe
 * measured wrong; the probe re-measures the pixels.
 */
describe("the pulled-for-service notice (issue #2345)", () => {
  it("names how many units went to the bench", () => {
    renderPrep(everyPanelPrep(), { notice: "gear-returned-set-pulled", noticeCount: "2" });
    expect(screen.getByRole("status")).toHaveTextContent("Back. 2 pulled for service.");
  });

  it("says nothing on a count it cannot read, rather than a wrong number", () => {
    renderPrep(everyPanelPrep(), { notice: "gear-returned-set-pulled", noticeCount: "-1" });
    expect(screen.queryByText(/pulled for service/)).toBeNull();
  });
});

/**
 * The "Sizes still missing" card no longer explains the list to itself, and
 * the gas-analysis disclaimer left the tab for the pre-departure checklist
 * settings (UX review 2026-10-10, item 26).
 */
describe("the sizes card on the Gear tab", () => {
  it("says no sentence about the list, and nothing about gas analysis", () => {
    const { container } = renderPrep(everyPanelPrep());
    expect(screen.getByRole("heading", { name: t("tripPrep.missingSizesHeading") })).toBeTruthy();
    expect(container.textContent).not.toContain("short by that piece");
    expect(container.textContent).not.toContain("gas analysis");
  });
});

describe("the packing list's geometry", () => {
  it("stacks its sections at the gap its page asks for, never a margin each (K-487)", () => {
    const { container } = renderPrep(everyPanelPrep(), { notice: "gear-released" });
    const stack = container.firstElementChild;
    expect(stack).toHaveClass(STACK);
    // Task navigation, tanks, nitrox, sizes, staff fit, pickups, kit, banner, assignments.
    expect(stack?.children.length).toBe(9);
    for (const section of stack?.children ?? []) {
      expect(tokens(section).filter((token) => /^mt-/.test(token))).toEqual([]);
    }
  });

  it("hands back only the height its own padding adds, so a name that wraps keeps its lines (K-146)", () => {
    // The never-asked names are links inside a sentence now (B54), so the
    // by-diver rows' names are the ones standing on lines of their own.
    const byDiver = renderPrep(everyPanelPrep(), { grouping: "diver" }).container;
    const carmen = diverLinks(byDiver).filter((link) => link.textContent === "Carmen Ruiz");
    expect(carmen).toHaveLength(2);
    for (const link of carmen) {
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
});

describe("a held seat on the Gear tab (issue #2144)", () => {
  it("says the sizes wait for the desk, by item and by diver, and never asks for a fit", () => {
    const byItem = renderPrep(heldPrep()).container;
    expect(within(byItem).getByText(t("tripPrep.heldSeatsHeading"))).toBeTruthy();
    expect(within(byItem).getAllByText("Tom Marsh").length).toBeGreaterThan(0);
    expect(within(byItem).queryByText(t("tripPrep.missingSizesHeading"))).toBeNull();
    // Nitrox asked for on a seat whose card is not provably theirs: a card check.
    expect(within(byItem).getByText(t("tripPrep.nitroxBlockedHeading"))).toBeTruthy();
    cleanup();

    const byDiver = renderPrep(heldPrep(), { grouping: "diver" }).container;
    expect(within(byDiver).getAllByText(t("tripPrep.heldSeatSizesWait")).length).toBeGreaterThan(0);
  });
});

/**
 * **A boat at sea packs nothing more** (fourth review, item 16). "6 people
 * missing rental sizes" is a question for the dock; the tanks and kit that
 * went out stay, because they are what has to come back.
 */
describe("a boat that has left the dock", () => {
  it("drops the missing-sizes prompt and keeps what went out", () => {
    const { container, unmount } = renderPrep(everyPanelPrep());
    const sizes = t("tripPrep.missingSizesHeading");
    expect(within(container).queryByText(sizes)).not.toBeNull();
    unmount();
    const atSea = renderPrep(everyPanelPrep(), { sailed: true });
    expect(within(atSea.container).queryByText(sizes)).toBeNull();
    expect(within(atSea.container).getByRole("heading", { name: "Tanks" })).toBeTruthy();
  });
});

describe("preparation task navigation", () => {
  it("links to the packing and assignment headings using the actual missing-piece count", () => {
    const prep = everyPanelPrep();
    const [row] = prep.assignmentRows;
    if (!row) throw new Error("assignment fixture missing");
    prep.assignmentRows = [
      { ...row, wanted: [{ kind: "regulator" }, { kind: "fins" }] as typeof row.wanted },
    ];
    renderPrep(prep);
    expect(screen.getByRole("link", { name: "Pull list" })).toHaveAttribute("href", "#kit-heading");
    expect(screen.getByRole("link", { name: "2 pieces to assign" })).toHaveAttribute(
      "href",
      "#assignments-heading",
    );
    expect(screen.getByRole("heading", { name: t("gear.prep.heading") })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
  it("offers no packing task navigation once the departure has sailed", () => {
    renderPrep(everyPanelPrep(), { sailed: true });
    expect(screen.queryByRole("navigation", { name: t("tripPrep.tasksLabel") })).toBeNull();
    expect(screen.getByRole("heading", { name: t("gear.prep.heading") })).toBeInTheDocument();
  });
});
