// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripBuddyTeam } from "@/db/buddy-pairs";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { BuddyTeamsPanel } from "./BuddyTeamsPanel";

afterEach(cleanup);

/** Keys back, with the one name the remove button's label carries. */
const t = ((key: string, values?: { name?: string }) =>
  values?.name ? `${key}:${values.name}` : key) as unknown as StaffTranslator;

const noop = async () => {};

function team(names: string[]): TripBuddyTeam {
  return {
    teamId: `team-${names.length}`,
    createdAt: new Date("2026-09-25T12:00:00Z"),
    recordedByName: "Keiko Tanaka",
    members: names.map((fullName, index) => ({
      kind: "diver" as const,
      bookingId: `b${index}`,
      fullName,
      cancelled: false,
    })),
  };
}

function renderPanel(teams: TripBuddyTeam[]) {
  render(
    <BuddyTeamsPanel
      defaultOpen
      intentLine={null}
      buddyTeamsList={teams}
      diverOptions={[]}
      crewOptions={[]}
      unteamedDivers={[]}
      divesWithByBooking={new Map()}
      buddyErrorText={null}
      buddyErrorForm={null}
      formBuddyTeamAction={noop}
      addBuddyTeamMemberAction={noop}
      removeBuddyTeamMemberAction={noop}
      dissolveBuddyTeamAction={noop}
      t={t}
    />,
  );
}

describe("a buddy team's member chips", () => {
  /**
   * **The remove button's ring stays inside its own circle** (pixel-craft
   * class 7). The global ring drew 5px outside the 44px circle, and the chip
   * sets the name 4px before it: the ring's left arm landed on the name's last
   * letter (the atlas's focus capture of the manifest's buddy panel, 0px
   * clearance). The inset twin is the same ring at −3px, 6px clear of the name.
   */
  it("rings a member's remove button inside its 44px circle", () => {
    renderPanel([team(["Marie Tharp", "Sylvia Earle", "Eugenie Clark"])]);
    const remove = screen.getByRole("button", {
      name: "manifest.buddyRemoveMember:Sylvia Earle",
    });
    expect(remove).toHaveClass("size-11", "rounded-full", "focus-visible:focus-ring-inset");
  });

  it("offers no remove button on a team of two, where the act is a dissolve", () => {
    renderPanel([team(["Marie Tharp", "Sylvia Earle"])]);
    expect(screen.queryByRole("button", { name: /manifest\.buddyRemoveMember/ })).toBeNull();
  });
});

describe("a buddy team's row", () => {
  /**
   * **One chip, whether or not it can lose a member** (pixel-craft class 12,
   * K-359). A team of three's chips hold a 44px remove target, and stood 50px
   * tall with the name 18px in; a team of two's were `px-3 py-1`, 34px with the
   * name 14px in — Team 01 small and tight over a tall Team 02. Both kinds now
   * share one box: the remove target's height, and one inset before the name.
   */
  it("draws every member chip at one height and one inset", () => {
    renderPanel([
      team(["Marie Tharp", "Sylvia Earle"]),
      team(["Ada Blackjack", "Jane Goodall", "Eugenie Clark"]),
    ]);
    const chips = [...document.querySelectorAll<HTMLElement>("li[data-buddy-member]")];
    expect(chips).toHaveLength(5);
    for (const chip of chips) {
      expect(chip).toHaveClass("min-h-12.5", "items-center", "ps-4");
      expect(chip.className).not.toMatch(/(^|\s)(px-3|py-1|py-0\.5)(\s|$)/);
    }
  });

  /**
   * **"Dissolve team" stands in the chip row, at the row's size** (pixel-craft
   * class 1, K-360). It was a 48px `md` button beside the label-and-chips
   * block, topped against it, so its words sat 15px off the chips' centre on a
   * team of two and 23px on a team of three (1280). As the chip list's last
   * item, at `sm`, it takes the chips' centre from the list's `items-center`,
   * and on a phone it wraps with them.
   */
  it("sets Dissolve team as the chip row's last item, at the chips' size", () => {
    renderPanel([team(["Marie Tharp", "Sylvia Earle"])]);
    const dissolve = screen.getByRole("button", { name: "manifest.buddyDissolve" });
    const chips = document.querySelector("li[data-buddy-member]")?.parentElement;
    const item = dissolve.closest("li");
    expect(chips).toHaveClass("items-center");
    expect(item?.parentElement).toBe(chips);
    expect(item).toBe(chips?.lastElementChild);
    expect(item).not.toHaveAttribute("data-buddy-member");
    expect(dissolve).toHaveClass("text-sm");
    expect(dissolve.className).not.toMatch(/(^|\s)min-h-12(\s|$)/);
  });
});

/**
 * **The panel's caret is sized to its heading** (K-549). It took
 * `DisclosureCaret`'s default `size-3`: a 4×8px tick beside the 18px "Buddy
 * teams" heading.
 */
describe("the panel's disclosure line", () => {
  it("draws its caret at size-4, beside the section title", () => {
    renderPanel([]);
    const summary = document.querySelector("summary");
    const caret = summary?.querySelector("svg");
    expect(caret).not.toBeNull();
    expect(caret).toHaveClass("size-4");
  });
});
