import { describe, expect, it } from "vitest";
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
  parties: ReadonlyMap<string, string> = new Map(),
) {
  return buddyBuilderView({
    manifest,
    buddyTeamsList: teamed.length
      ? ([
          { id: "team-1", members: teamed.map((bookingId) => ({ kind: "diver", bookingId })) },
        ] as never)
      : [],
    buddyError,
    parties,
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

  it("says who came together and who came alone, and counts the parties one tap would team", () => {
    expect(view().panel.partyLines).toBeNull();
    const { panel } = view(undefined, [], new Map([["b-2", "b-1"]]));
    expect(panel.partyLines).toEqual({
      together: t("manifest.buddyCameTogether", { parties: "Ana Ruiz and Ben Okafor" }),
      alone: null,
      teamable: 1,
    });
  });
});
