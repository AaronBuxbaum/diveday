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
