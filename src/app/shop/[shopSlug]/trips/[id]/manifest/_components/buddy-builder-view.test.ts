import { describe, expect, it } from "vitest";
import type { PartyTeamPlan } from "@/db/buddy-pairs";
import { buddyBuilderView } from "./buddy-builder-view";
import { diver, t } from "./diver-roll-call-test-fixtures";
import { crewMember, tripManifest } from "./manifest-page-test-fixtures";

const manifest = tripManifest({
  divers: [
    diver({ bookingId: "b-1", fullName: "Ana Ruiz" }),
    diver({ bookingId: "b-2", fullName: "Ben Okafor" }),
    diver({ bookingId: "b-3", fullName: "Cleo Park", participantType: "snorkeler" }),
  ],
  crew: [crewMember()],
});

function view(
  buddyError?: string,
  teamed: string[] = [],
  partyPlan: PartyTeamPlan = { parties: new Map(), teamable: [], left: [] },
) {
  return buddyBuilderView({
    manifest,
    buddyTeamsList: teamed.length
      ? ([
          { id: "team-1", members: teamed.map((bookingId) => ({ kind: "diver", bookingId })) },
        ] as never)
      : [],
    buddyError,
    partyPlan,
    locale: "en-US",
    t,
  });
}

describe("buddyBuilderView", () => {
  it("offers every free diver and every crew member, never a snorkeler or a teamed diver", () => {
    const { panel } = view(undefined, ["b-1"]);
    expect(panel.diverOptions).toEqual([{ token: "diver:b-2", label: "Ben Okafor" }]);
    expect(panel.crewOptions).toEqual([
      { token: "crew:00000000-0000-4000-8000-0000000000c1", label: "Keiko Tanaka" },
    ]);
  });

  it("puts `few` in the builder and every other refusal at the top of the panel", () => {
    expect(view("few").panel.buddyErrorForm).toBe("builder");
    expect(view("duplicate").panel.buddyErrorForm).toBe("panel");
    expect(view("whatever").panel.buddyErrorText).toBe(t("manifest.buddyErrorGeneric"));
    expect(view().panel.buddyErrorForm).toBeNull();
  });

  it("names a team once per person, joined in the reader's language", () => {
    const { buddyTeamLabel } = view();
    expect(buddyTeamLabel([])).toBeNull();
    const label = buddyTeamLabel([
      { teamId: "a", others: [{ fullName: "Ana Ruiz" }, { fullName: "Ben Okafor" }] },
      { teamId: "b", others: [{ fullName: "Ana Ruiz" }] },
    ] as never);
    expect(label).toBe(t("shared.buddyTeam.with", { names: "Ana Ruiz and Ben Okafor" }));
  });

  it("says who came together and who came alone, and counts the parties the action would team", () => {
    expect(view().panel.partyLines).toBeNull();
    const { panel } = view(undefined, [], {
      parties: new Map([["b-2", "b-1"]]),
      teamable: [["b-1", "b-2"]],
      left: [],
    });
    expect(panel.partyLines).toEqual({
      together: t("manifest.buddyCameTogether", { parties: "Ana Ruiz and Ben Okafor" }),
      alone: null,
      left: [],
      teamable: 1,
    });
  });

  /**
   * Dive-domain review of layer r5-4, BLOCK 1 and note 8: the count is the
   * action's own plan, never a second reading of the manifest, and a party the
   * tap leaves is named with the reason.
   */
  it("counts no party the plan leaves, and says why it was left", () => {
    const { panel } = view(undefined, [], {
      parties: new Map([["b-2", "b-1"]]),
      teamable: [],
      left: [{ bookingIds: ["b-1", "b-2"], reason: "young_child" }],
    });
    expect(panel.partyLines?.teamable).toBe(0);
    expect(panel.partyLines?.left).toEqual([
      t("manifest.buddyPartyLeft", {
        names: "Ana Ruiz and Ben Okafor",
        reason: t("manifest.buddyPartyLeftReason.young_child"),
      }),
    ]);
  });
});
