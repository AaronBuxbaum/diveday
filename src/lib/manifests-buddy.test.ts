import { describe, expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import { boardedAt, crewMember, notBoardedAt, trip } from "./manifest-test-fixtures";
import {
  buddyAlertFor,
  buildTripManifest,
  type ManifestBuddyTeam,
  type ManifestDiverInput,
  type RollCallRecord,
  splitBuddyTeamIds,
} from "./manifests";
import {
  latestOfflineRollCall,
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineManifestSnapshot,
  type OfflineRollCallEvent,
  serializeManifests,
} from "./offline-manifests";

describe("buddy teams — the split-team alert (ADR 20260804-buddy-teams)", () => {
  const carriedAshore: RollCallRecord = { ...notBoardedAt(), implied: true };

  it("says nothing unless this person is themselves back aboard", () => {
    // The alert renders on whoever is back — a teammate's own row already
    // carries whatever state matters about *them*.
    expect(buddyAlertFor("after_dive_1", undefined, [boardedAt()])).toBeNull();
    expect(buddyAlertFor("after_dive_1", notBoardedAt(), [undefined])).toBeNull();
    expect(buddyAlertFor("after_dive_1", carriedAshore, [undefined])).toBeNull();
  });

  it("is quiet when the team's statuses agree, and when there is no team at all", () => {
    expect(buddyAlertFor("departure", boardedAt(), [boardedAt()])).toBeNull();
    expect(buddyAlertFor("after_dive_1", boardedAt(), [boardedAt(), boardedAt()])).toBeNull();
    expect(buddyAlertFor("departure", undefined, [undefined])).toBeNull();
    // An empty teammate list is nobody to diverge from — never an alert.
    expect(buddyAlertFor("after_dive_1", boardedAt(), [])).toBeNull();
  });

  it("raises the dock heads-up while one is aboard and another is not yet", () => {
    expect(buddyAlertFor("departure", boardedAt(), [undefined])).toBe("separated_dock");
  });

  it("prompts the remaining team to re-pair when a member stays ashore", () => {
    expect(buddyAlertFor("departure", boardedAt(), [notBoardedAt()])).toBe("teammate_ashore");
    // Re-pairing is the actionable fact even while a third person is uncalled.
    expect(buddyAlertFor("departure", boardedAt(), [notBoardedAt(), undefined])).toBe(
      "teammate_ashore",
    );
  });

  it("raises the loud alert after a dive only once a teammate is recorded not back", () => {
    expect(buddyAlertFor("after_dive_1", boardedAt(), [notBoardedAt()])).toBe(
      "separated_after_dive",
    );
  });

  it("stays quiet after a dive while a teammate is merely uncalled", () => {
    // **An alarm is earned by a recorded fact, never by the absence of one**
    // (ADR 20260827-the-departure-is-two-working-surfaces, decision 4). A crew
    // starts the surface-interval count believing everyone is back, so the
    // first diver counted in must not paint the second one red before anybody
    // has said a word about them — which is what an uncalled teammate used to
    // do, on every row of every count.
    expect(buddyAlertFor("after_dive_1", boardedAt(), [undefined])).toBeNull();
    expect(buddyAlertFor("after_dive_1", boardedAt(), [boardedAt(), undefined])).toBeNull();
  });

  it("needs only one teammate recorded not back, however large the team", () => {
    // Three of four back is exactly as loud as one of two: the boat's next
    // move is identical, and a team is not a severity scale.
    expect(
      buddyAlertFor("after_dive_1", boardedAt(), [boardedAt(), boardedAt(), notBoardedAt()]),
    ).toBe("separated_after_dive");
    expect(
      buddyAlertFor("after_dive_1", boardedAt(), [boardedAt(), boardedAt(), boardedAt()]),
    ).toBeNull();
  });

  it("keeps the ashore re-pairing prompt distinct from a recorded non-return", () => {
    // Carried forward from departure: they never left. Accounted for on land,
    // not missing from the water — alarming here would teach the crew to stop
    // reading the panel.
    expect(buddyAlertFor("after_dive_1", boardedAt(), [carriedAshore])).toBe("teammate_ashore");
    // …but a second teammate a human recorded as not back is still loud, so
    // the exemption can never silence a real one.
    expect(buddyAlertFor("after_dive_1", boardedAt(), [carriedAshore, notBoardedAt()])).toBe(
      "separated_after_dive",
    );
  });

  it("clears the re-pairing prompt when the buddy returns, everyone stays ashore, or a new team is formed", () => {
    expect(buddyAlertFor("departure", boardedAt(), [boardedAt()])).toBeNull();
    expect(buddyAlertFor("departure", notBoardedAt(), [notBoardedAt()])).toBeNull();
    expect(buddyAlertFor("after_dive_1", carriedAshore, [carriedAshore])).toBeNull();
    expect(buddyAlertFor("departure", boardedAt(), [])).toBeNull();
  });

  const diver = (
    bookingId: string,
    fullName: string,
    extra: Partial<ManifestDiverInput> = {},
  ): ManifestDiverInput => ({
    bookingId,
    fullName,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "own_kit" as const },
    nitroxRequested: false,
    checkedIn: false,
    ...extra,
  });

  const team = (teamId: string, others: ManifestBuddyTeam["others"]) => ({ teamId, others });
  const otherDiver = (bookingId: string, fullName: string) =>
    ({ kind: "diver", bookingId, fullName }) as const;
  const otherCrew = (personId: string, fullName: string) =>
    ({ kind: "crew", personId, fullName }) as const;

  it("reads a queued ashore mark beside a saved aboard mark, and clears it on a queued return", () => {
    const saved = buildTripManifest({
      trip,
      crew: [],
      divers: [
        diver("a", "Ana", { rollCall: boardedAt() }),
        diver("b", "Ben", { rollCall: boardedAt() }),
      ],
    });
    const snapshot: OfflineManifestSnapshot = {
      ...serializeManifests(
        [saved],
        {
          slug: "blue-mantis",
          name: "Blue Mantis",
          timezone: "America/New_York",
          emergencyReference: EMPTY_EMERGENCY_REFERENCE,
        },
        () => "",
      ),
      version: OFFLINE_MANIFEST_RECORD_VERSION,
      snapshotId: "snapshot-buddy",
      savedAt: "2026-07-20T11:45:00.000Z",
      expiresAt: "2026-07-27T16:00:00.000Z",
    };
    const ashore: OfflineRollCallEvent = {
      clientEventId: "buddy-ashore",
      snapshotId: snapshot.snapshotId,
      snapshotSavedAt: snapshot.savedAt,
      tripId: trip.id,
      bookingId: "b",
      checkpoint: "departure",
      status: "not_boarded",
      occurredAt: "2026-07-20T11:46:00.000Z",
      syncStatus: "pending",
    };
    const alert = (events: OfflineRollCallEvent[]) =>
      buddyAlertFor("departure", latestOfflineRollCall(snapshot, events, "a", "departure"), [
        latestOfflineRollCall(snapshot, events, "b", "departure"),
      ]);
    expect(alert([ashore])).toBe("teammate_ashore");
    expect(
      alert([ashore, { ...ashore, clientEventId: "buddy-returned", status: "boarded" }]),
    ).toBeNull();
  });

  it("names only the actual non-return when a crew member also leads a team with someone ashore", () => {
    const build = (checkpoint: "departure" | "after_dive_1") =>
      buildTripManifest({
        trip,
        checkpoint,
        crew: [
          crewMember({
            id: "dm",
            fullName: "Dana",
            roles: ["divemaster"],
            rollCall: boardedAt(),
            buddyTeams: [
              team("ashore-team", [otherDiver("land", "Lena")]),
              team("missing-team", [otherDiver("missing", "Mia")]),
            ],
          }),
        ],
        divers: [
          diver("land", "Lena", {
            rollCall: checkpoint === "departure" ? notBoardedAt() : carriedAshore,
          }),
          diver("missing", "Mia", {
            rollCall: checkpoint === "departure" ? undefined : notBoardedAt(),
          }),
        ],
      });
    const dock = build("departure");
    expect(dock.crew[0]).toMatchObject({ buddyAlert: "teammate_ashore", buddyMissing: ["Lena"] });
    const after = build("after_dive_1");
    expect(after.crew[0]).toMatchObject({
      buddyAlert: "separated_after_dive",
      buddyMissing: ["Mia"],
    });
    expect(splitBuddyTeamIds(after, "separated_after_dive")).toEqual(new Set(["missing-team"]));
    expect(splitBuddyTeamIds(after, "teammate_ashore")).toEqual(new Set(["ashore-team"]));
  });

  it("derives the alert through buildTripManifest, on the returned row only", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [],
      divers: [
        diver("booking-tom", "Tom Okafor", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("booking-lena", "Lena Fischer")]),
        }),
        diver("booking-lena", "Lena Fischer", {
          // Recorded not back aboard — the fact that earns the alert on Tom's
          // row (decision 4 of ADR 20260827-the-departure-is-two-working-surfaces).
          rollCall: notBoardedAt(),
          buddyTeam: team("team-1", [otherDiver("booking-tom", "Tom Okafor")]),
        }),
        // The odd diver out — unteamed, and that is normal, never an error.
        diver("booking-omar", "Omar Haddad"),
      ],
    });
    expect(manifest.divers.find((d) => d.bookingId === "booking-tom")?.buddyAlert).toBe(
      "separated_after_dive",
    );
    expect(manifest.divers.find((d) => d.bookingId === "booking-lena")?.buddyAlert).toBeNull();
    expect(manifest.divers.find((d) => d.bookingId === "booking-omar")?.buddyAlert).toBeNull();
  });

  it("reads a crew teammate's own roll call, and puts the alert on the crew row too", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [
        crewMember({
          id: "person-keiko",
          fullName: "Keiko Tanaka",
          roles: ["divemaster"],
          rollCall: boardedAt(),
          buddyTeams: [team("team-1", [otherDiver("booking-tom", "Tom Okafor")])],
        }),
      ],
      divers: [
        diver("booking-tom", "Tom Okafor", {
          rollCall: notBoardedAt(),
          buddyTeam: team("team-1", [otherCrew("person-keiko", "Keiko Tanaka")]),
        }),
      ],
    });
    // The divemaster is back and the diver they led is recorded not back — the
    // split reads on the DM's row, which is the row a deck is looking at.
    expect(manifest.crew[0]?.buddyAlert).toBe("separated_after_dive");
    expect(manifest.divers[0]?.buddyAlert).toBeNull();
  });

  it("counts split *teams*, not rows wearing an alert", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [],
      divers: [
        diver("a", "A", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("b", "B"), otherDiver("c", "C")]),
        }),
        diver("b", "B", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("a", "A"), otherDiver("c", "C")]),
        }),
        diver("c", "C", {
          rollCall: notBoardedAt(),
          buddyTeam: team("team-1", [otherDiver("a", "A"), otherDiver("b", "B")]),
        }),
      ],
    });
    // Two rows wear the alert; one team is split.
    expect(manifest.divers.filter((d) => d.buddyAlert !== null)).toHaveLength(2);
    expect(splitBuddyTeamIds(manifest, "separated_after_dive")).toEqual(new Set(["team-1"]));
  });

  it("yields no alert for a teammate reference that is not on the manifest", () => {
    // Defensive: a stale reference (roster changed between reads) must not
    // fabricate an alert about a person who is not on the boat.
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [],
      divers: [
        diver("booking-tom", "Tom Okafor", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("booking-gone", "Gone Diver")]),
        }),
      ],
    });
    expect(manifest.divers[0]?.buddyAlert).toBeNull();
  });

  it("never lets a team change the checkpoint verdict", () => {
    const base = {
      trip,
      checkpoint: "after_dive_1" as const,
      crew: [],
      divers: [
        diver("booking-tom", "Tom Okafor", { rollCall: boardedAt() }),
        diver("booking-lena", "Lena Fischer"),
      ],
    };
    const unteamed = buildTripManifest(base);
    const teamed = buildTripManifest({
      ...base,
      divers: [
        diver("booking-tom", "Tom Okafor", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("booking-lena", "Lena Fischer")]),
        }),
        diver("booking-lena", "Lena Fischer", {
          buddyTeam: team("team-1", [otherDiver("booking-tom", "Tom Okafor")]),
        }),
      ],
    });
    expect(teamed.completeness).toEqual(unteamed.completeness);
    expect(teamed.summary).toEqual(unteamed.summary);
  });
});
