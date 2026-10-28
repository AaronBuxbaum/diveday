// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripBuddyTeam } from "@/db/buddy-pairs";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { BuddyTeamsPanel } from "./BuddyTeamsPanel";

afterEach(cleanup);

/** Keys back, with the one name the remove button's label carries. */
const t = ((key: string, values?: { name?: string; number?: number }) =>
  values?.name
    ? `${key}:${values.name}`
    : values?.number
      ? `${key}:${values.number}`
      : key) as unknown as StaffTranslator;

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

function renderPanel(
  teams: TripBuddyTeam[],
  partyLines: {
    together: string;
    alone: string | null;
    left: string[];
    teamable: number;
    confirmAdults: { key: string; label: string }[];
  } | null = null,
  teamWarnings: Record<string, string[]> = {},
  options: {
    defaultOpen?: boolean;
    buddyErrorText?: string | null;
    buddyErrorForm?: "builder" | "panel" | null;
  } = {},
) {
  render(
    <BuddyTeamsPanel
      defaultOpen={options.defaultOpen ?? true}
      intentLine={null}
      buddyTeamsList={teams}
      diverOptions={[]}
      crewOptions={[]}
      unteamedDivers={[]}
      buddyErrorText={options.buddyErrorText ?? null}
      buddyErrorForm={options.buddyErrorForm ?? null}
      partyLines={partyLines}
      teamWarnings={teamWarnings}
      teamUpPartiesAction={noop}
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

  /**
   * **The remove mark is drawn**, the cross every remove control shares, at
   * the names' 16px (pixel-craft K-545). It was a typed "×" at `text-lg`, so
   * removing a person was drawn one way here and another on the crew row. The
   * accessible name stays the sentence naming who leaves the team.
   */
  it("draws its remove mark, named by the sentence rather than the glyph", () => {
    renderPanel([team(["Marie Tharp", "Sylvia Earle", "Eugenie Clark"])]);
    const remove = screen.getByRole("button", {
      name: "manifest.buddyRemoveMember:Sylvia Earle",
    });
    const mark = remove.querySelector("svg");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveClass("size-4");
    expect(remove).not.toHaveTextContent("×");
  });

  it("offers no remove button on a team of two, where the act is a dissolve", () => {
    renderPanel([team(["Marie Tharp", "Sylvia Earle"])]);
    expect(screen.queryByRole("button", { name: /manifest\.buddyRemoveMember/ })).toBeNull();
  });
});

describe("a buddy team's row", () => {
  it("keeps an informational caution with its team names and leaves dissolve available in the editor", () => {
    renderPanel([team(["Ana Ruiz", "Ben Okafor"])], null, {
      "team-2": ["Check pairing: a diver under 12.", "Teamed with a diver not cleared to board"],
    });
    const caution = screen.getByText("Check pairing: a diver under 12.");
    expect(caution.closest("li")).toHaveTextContent("Ana Ruiz, Ben Okafor");
    expect(screen.getByText("Teamed with a diver not cleared to board")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "manifest.buddyDissolve" })).toBeEnabled();
  });

  it("marks canceled divers and crew in the at-rest caution context", () => {
    renderPanel(
      [
        {
          ...team(["Ana Ruiz", "Ben Okafor"]),
          teamId: "mixed-team",
          members: [
            { kind: "diver", bookingId: "cancelled", fullName: "Ana Ruiz", cancelled: true },
            { kind: "diver", bookingId: "active", fullName: "Ben Okafor", cancelled: false },
            { kind: "crew", personId: "crew-1", fullName: "Riley Chen" },
          ],
        },
      ],
      null,
      { "mixed-team": ["Check pairing: a diver under 12."] },
      { defaultOpen: false },
    );
    const caution = screen.getByText("Check pairing: a diver under 12.");
    expect(caution.closest("li")).toHaveTextContent("manifest.buddyCancelledName:Ana Ruiz");
    expect(caution.closest("li")).toHaveTextContent("Ben Okafor");
    expect(caution.closest("li")).toHaveTextContent("manifest.buddyCrewName:Riley Chen");
  });

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
    expect(document.querySelector("details")?.open).toBe(true);
  });

  it("keeps specific safety cautions visible with their team context while the editor stays closed", () => {
    renderPanel(
      [team(["Ana Ruiz", "Ben Okafor"])],
      null,
      {
        "team-2": ["Check pairing: a diver under 12.", "Teamed with a diver not cleared to board"],
      },
      { defaultOpen: false },
    );
    const details = document.querySelector("details");
    expect(details?.open).toBe(false);
    const caution = screen.getByText("Check pairing: a diver under 12.");
    expect(caution.closest("li")).toHaveTextContent("manifest.buddyTeamLabel:1");
    expect(caution.closest("li")).toHaveTextContent("Ana Ruiz, Ben Okafor");
    expect(screen.getByText("Teamed with a diver not cleared to board")).toBeInTheDocument();
  });

  it("still opens for a refusal even when the panel was not requested open", () => {
    renderPanel(
      [],
      null,
      {},
      {
        defaultOpen: false,
        buddyErrorText: "This team cannot be formed",
        buddyErrorForm: "panel",
      },
    );
    expect(document.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("This team cannot be formed")).toBeInTheDocument();
  });
});

describe("who came together (item 50)", () => {
  it("says the parties and who came alone, and offers one tap when a party can team", () => {
    renderPanel([], {
      together: "Came together: Ana and Ben",
      alone: "Came alone: Cleo",
      left: [],
      teamable: 1,
      confirmAdults: [],
    });
    expect(screen.getByText("Came together: Ana and Ben")).toBeInTheDocument();
    expect(screen.getByText("Came alone: Cleo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "manifest.buddyTeamUpParties" })).toBeInTheDocument();
  });

  it("offers no tap when every party is too big to team whole", () => {
    renderPanel([], {
      together: "Came together: a family of four",
      alone: null,
      left: ["Left for you: a family of four (more than three)"],
      teamable: 0,
      confirmAdults: [],
    });
    expect(screen.queryByRole("button", { name: "manifest.buddyTeamUpParties" })).toBeNull();
    expect(
      screen.getByText("Left for you: a family of four (more than three)"),
    ).toBeInTheDocument();
  });
});

/**
 * **"Team up each party" asks before teaming a party nobody has said is adult**
 * (issue 2808): one tick box per such party, carrying its exact seats, and the
 * button stands even when that party is the only one to team.
 */
describe("the one-tap party teams", () => {
  const lines = {
    together: "Came together",
    alone: null,
    left: [],
    teamable: 0,
    confirmAdults: [{ key: "b1,b2", label: "Ana and Ben are 18 or over" }],
  };

  it("offers a tick box per unconfirmed party, unticked, beside the button", () => {
    renderPanel([], lines);
    const box = screen.getByRole("checkbox", { name: "Ana and Ben are 18 or over" });
    expect(box).not.toBeChecked();
    expect(box).toHaveAttribute("name", "adultParty");
    expect(box).toHaveAttribute("value", "b1,b2");
    expect(screen.getByText("manifest.buddyPartyConfirmHint")).toBeInTheDocument();
    expect(box.closest("form")).toBe(
      screen.getByRole("button", { name: "manifest.buddyTeamUpParties" }).closest("form"),
    );
  });

  it("asks nothing when every party's ages are on file", () => {
    renderPanel([], { ...lines, teamable: 1, confirmAdults: [] });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("manifest.buddyPartyConfirmHint")).toBeNull();
    expect(screen.getByRole("button", { name: "manifest.buddyTeamUpParties" })).toBeInTheDocument();
  });
});
