import { describe, expect, it } from "vitest";
import type { PartyTeamPlan, TripBuddyTeam } from "@/db/buddy-pairs";
import { partyLeftReasonText } from "@/i18n/buddy-labels";
import { partyLeftReason } from "@/lib/party-teams";
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

const NAMES = new Map([
  ["b-1", "Ana Ruiz"],
  ["b-2", "Ben Okafor"],
]);

function plan(overrides: Partial<PartyTeamPlan>): PartyTeamPlan {
  return {
    departure: { course: null },
    members: new Map(),
    parties: new Map(),
    teamable: [],
    ageUnconfirmed: [],
    left: [],
    alone: [],
    names: NAMES,
    ...overrides,
  };
}

function view(buddyError?: string, teamed: string[] = [], partyPlan: PartyTeamPlan = plan({})) {
  return buddyBuilderView({
    manifest,
    buddyTeamsList: teamed.length ? [team(teamed)] : [],
    buddyError,
    partyPlan,
    locale: "en-US",
    t,
  });
}

function team(bookingIds: string[], crewId?: string): TripBuddyTeam {
  return {
    teamId: "team-1",
    createdAt: new Date("2026-09-25T12:00:00Z"),
    recordedByName: "Keiko Tanaka",
    members: [
      ...bookingIds.map((bookingId) => ({
        kind: "diver" as const,
        bookingId,
        fullName: NAMES.get(bookingId) ?? bookingId,
        cancelled: false,
      })),
      ...(crewId ? [{ kind: "crew" as const, personId: crewId, fullName: "Keiko Tanaka" }] : []),
    ],
  };
}

describe("buddyBuilderView", () => {
  it("explains a busy one-tap attempt without claiming a team was formed", () => {
    expect(view("busy").panel.buddyErrorText).toBe(t("manifest.buddyErrorBusy"));
  });
  it.each([
    { departure: { course: null }, age: 11 },
    { departure: { course: { intro: true } }, age: 35 },
    { departure: { course: { intro: false } }, age: 35 },
  ])("warns on a manual team using the same party rule: %j", ({ departure, age }) => {
    const member = { age, declaredMinor: age < 18, verifiedCard: true };
    const reason = partyLeftReason(departure, [member, member]);
    if (!reason) throw new Error("expected a shared caution");
    const { panel } = view(
      undefined,
      ["b-1", "b-2"],
      plan({
        departure,
        members: new Map([
          ["b-1", member],
          ["b-2", member],
        ]),
      }),
    );
    expect(panel.teamWarnings["team-1"]).toContain(
      t("manifest.buddyTeamCaution", {
        reason: partyLeftReasonText(t, reason),
      }),
    );
    // The warning leaves every mutation control available.
    expect(panel.buddyErrorText).toBeNull();
  });

  it.each(["medical_review", "medical_not_cleared", "certification_missing"] as const)(
    "warns from existing readiness without exposing the %s detail",
    (code) => {
      // Extra private data must never be interpolated into the generic warning.
      const blocker = { code, privateMedicalAnswer: "Private medical answer" };
      const blocked = tripManifest({
        divers: [
          diver({ bookingId: "b-1", readiness: { status: "blocked", blockers: [blocker] } }),
          diver({ bookingId: "b-2" }),
        ],
      });
      const result = buddyBuilderView({
        manifest: blocked,
        partyPlan: plan({}),
        buddyTeamsList: [team(["b-1", "b-2"])],
        buddyError: undefined,
        locale: "en-US",
        t,
      });
      expect(result.panel.teamWarnings["team-1"]).toEqual([t("manifest.buddyTeamNotCleared")]);
      expect(JSON.stringify(result.panel.teamWarnings)).not.toContain("Private medical answer");
    },
  );

  it("keeps a junior's certified adult context, and never treats a crew label as a card", () => {
    const junior = {
      age: 13,
      declaredMinor: true,
      verifiedCard: true,
      certifications: [{ agency: "padi", juniorStatus: "junior" as const }],
    };
    const adult = { age: 40, declaredMinor: false, verifiedCard: true };
    expect(
      view(
        undefined,
        ["b-1", "b-2"],
        plan({
          members: new Map([
            ["b-1", junior],
            ["b-2", adult],
          ]),
        }),
      ).panel.teamWarnings["team-1"],
    ).toEqual([]);
    const result = buddyBuilderView({
      manifest,
      partyPlan: plan({ members: new Map([["b-1", junior]]) }),
      buddyTeamsList: [team(["b-1"], manifest.crew[0]?.id)],
      buddyError: undefined,
      locale: "en-US",
      t,
    });
    expect(result.panel.teamWarnings["team-1"]).toContain(
      t("manifest.buddyTeamCaution", {
        reason: t("manifest.buddyPartyLeftReason.junior_without_adult"),
      }),
    );
  });

  it("ignores cancelled members and keeps crew-only teams free of diver cautions", () => {
    const cancelled = team(["b-1", "b-2"]);
    const member = cancelled.members[0];
    if (member?.kind !== "diver") throw new Error("diver fixture missing");
    member.cancelled = true;
    const result = buddyBuilderView({
      manifest: tripManifest({
        divers: [
          diver({
            bookingId: "b-1",
            readiness: { status: "blocked", blockers: [{ code: "medical_review" }] },
          }),
          diver({ bookingId: "b-2" }),
        ],
      }),
      partyPlan: plan({
        members: new Map([["b-1", { age: 11, declaredMinor: true, verifiedCard: true }]]),
      }),
      buddyTeamsList: [cancelled, { ...team([], "crew-1"), teamId: "crew-team" }],
      buddyError: undefined,
      locale: "en-US",
      t,
    });
    expect(result.panel.teamWarnings).toEqual({ "team-1": [], "crew-team": [] });
  });

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
    const { panel } = view(
      undefined,
      [],
      plan({ parties: new Map([["b-2", "b-1"]]), teamable: [["b-1", "b-2"]] }),
    );
    expect(panel.partyLines).toEqual({
      together: t("manifest.buddyCameTogether", { parties: "Ana Ruiz and Ben Okafor" }),
      alone: null,
      left: [],
      teamable: 1,
      confirmAdults: [],
    });
  });

  /**
   * Dive-domain review of layer r5-4, BLOCK 1 and note 8: the count is the
   * action's own plan, never a second reading of the manifest, and a party the
   * tap leaves is named with the reason.
   */
  it("counts no party the plan leaves, and says why it was left", () => {
    const { panel } = view(
      undefined,
      [],
      plan({
        parties: new Map([["b-2", "b-1"]]),
        left: [{ bookingIds: ["b-1", "b-2"], reason: "young_child" }],
      }),
    );
    expect(panel.partyLines?.teamable).toBe(0);
    expect(panel.partyLines?.left).toEqual([
      t("manifest.buddyPartyLeft", {
        names: "Ana Ruiz and Ben Okafor",
        reason: t("manifest.buddyPartyLeftReason.young_child"),
      }),
    ]);
  });

  /**
   * Dive-domain review of layer r5-4, second pass, N7: every line is drawn from
   * the plan, never a second reading of the manifest. A party the plan leaves
   * is said even with no party to team, and a seat the manifest no longer lists
   * keeps the plan's own name for it.
   */
  it("says a tap that teamed nobody needs a tick (issue 2808)", () => {
    expect(view("confirm-adults").panel.buddyErrorText).toBe(t("manifest.buddyErrorConfirmAdults"));
    expect(view("confirm-adults").panel.buddyErrorForm).toBe("panel");
  });

  it("draws every line from the plan's own seats and names", () => {
    const { panel } = view(
      undefined,
      [],
      plan({
        left: [{ bookingIds: ["b-1", "b-9"], reason: "junior_without_adult" }],
        alone: ["b-2"],
        names: new Map([...NAMES, ["b-9", "Dara Ruiz"]]),
      }),
    );
    expect(panel.partyLines).toEqual({
      together: t("manifest.buddyCameTogether", { parties: "Ana Ruiz and Dara Ruiz" }),
      alone: t("manifest.buddyCameAlone", { names: "Ben Okafor" }),
      left: [
        t("manifest.buddyPartyLeft", {
          names: "Ana Ruiz and Dara Ruiz",
          reason: t("manifest.buddyPartyLeftReason.junior_without_adult"),
        }),
      ],
      teamable: 0,
      confirmAdults: [],
    });
  });

  /**
   * Issue 2808: a party with someone who has neither a date of birth nor the
   * "Under 18" box is named on its own tick box, carrying that party's exact
   * seats, and is counted among the parties who came together.
   */
  it("asks the staffer to confirm each party whose ages nobody has said, naming who", () => {
    const { panel } = view(
      undefined,
      [],
      plan({
        ageUnconfirmed: [["b-2", "b-1"]],
        members: new Map([
          ["b-1", { age: 40, declaredMinor: false, verifiedCard: true }],
          ["b-2", { age: null, declaredMinor: false, verifiedCard: true }],
        ]),
        names: new Map([...NAMES, ["b-9", "Dara Ruiz"]]),
      }),
    );
    expect(panel.partyLines).toEqual({
      together: t("manifest.buddyCameTogether", { parties: "Ben Okafor and Ana Ruiz" }),
      alone: null,
      left: [],
      teamable: 0,
      confirmAdults: [
        {
          key: "b-1,b-2",
          label: t("manifest.buddyPartyConfirmAdults", {
            names: "Ben Okafor and Ana Ruiz",
            unknown: "Ben Okafor",
          }),
        },
      ],
    });
  });
});
