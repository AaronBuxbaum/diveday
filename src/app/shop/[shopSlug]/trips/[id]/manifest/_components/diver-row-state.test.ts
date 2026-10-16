import { describe, expect, it } from "vitest";
import type { TripManifest } from "@/lib/manifests";
import { boardedAt, diver, notBackAt } from "./diver-roll-call-test-fixtures";
import { diverRowState } from "./diver-row-state";

/**
 * **One derivation of what a diver's row is** — called directly, so the
 * capsule's priority and the dock's gate are read as data rather than through
 * the markup that draws them (the list's own tests do that).
 */
const blocked: TripManifest["divers"][number]["readiness"] = {
  status: "blocked",
  blockers: [{ code: "certification_missing" }],
};
const refusedBefore = {
  at: new Date("2026-09-01T12:00:00.000Z"),
  source: "digital",
  overriddenReferralAt: null,
  overriddenRefusal: { recordId: "w-refused", at: new Date("2026-08-20T12:00:00.000Z") },
  guardian: null,
} as unknown as TripManifest["divers"][number]["medicalWaiver"];
const deep = {
  status: "exceeds",
  siteDepth: 30,
  limitDepth: 18,
  unit: "meters",
  basis: "certification",
  level: null,
} as const;

describe("diverRowState's one capsule", () => {
  it("is nothing for a diver who is only a name and a mark", () => {
    expect(
      diverRowState(diver(), "after_dive_1", false, "America/New_York").capsuleKind,
    ).toBeNull();
  });

  it("goes to a team that did not come back, even over the alarm", () => {
    const state = diverRowState(
      diver({
        rollCall: notBackAt(),
        buddyAlert: "separated_after_dive",
        buddyTeam: { teamId: "t-1", others: [] },
      }),
      "after_dive_1",
      false,
      "America/New_York",
    );
    expect(state.alarmed).toBe(true);
    expect(state.capsuleKind).toBe("buddy");
  });

  it("carries nothing else beside a diver recorded not back aboard", () => {
    const state = diverRowState(
      diver({ rollCall: notBackAt(), age: 13, minor: true, birthday: { status: "today" } }),
      "after_dive_1",
      false,
      "America/New_York",
    );
    expect(state.capsuleKind).toBeNull();
  });

  it("ranks a desk blocker at the dock over a physician's earlier no", () => {
    const state = diverRowState(
      diver({ readiness: blocked, medicalWaiver: refusedBefore }),
      "departure",
      true,
      "America/New_York",
    );
    expect(state.blockedAtDock).toBe(true);
    expect(state.capsuleKind).toBe("blocked");
  });

  it("ranks a medical warning over the minor, the minor over depth, depth over a birthday", () => {
    const at = (overrides: Partial<TripManifest["divers"][number]>) =>
      diverRowState(diver(overrides), "after_dive_1", false, "America/New_York").capsuleKind;
    expect(at({ medicalWaiver: refusedBefore, age: 13, minor: true })).toBe("medical");
    expect(at({ age: 13, minor: true, depthAdvisory: deep })).toBe("minor");
    expect(at({ depthAdvisory: deep, birthday: { status: "today" } })).toBe("depth");
    expect(at({ birthday: { status: "today" } })).toBe("birthday");
  });

  it("gives a split team after a dive the capsule and keeps the medical hold for the panel", () => {
    const state = diverRowState(
      diver({
        boardedEarlier: true,
        readiness: { status: "blocked", blockers: [{ code: "medical_not_cleared" }] },
        buddyAlert: "separated_after_dive",
        buddyTeam: { teamId: "t-1", others: [] },
      }),
      "after_dive_1",
      false,
      "America/New_York",
    );
    expect(state.capsuleKind).toBe("buddy");
    expect(state.medicalHold).toBe("medical_not_cleared");
    expect(state.medicalHoldInPanel).toBe("medical_not_cleared");
  });

  it("does not repeat the medical hold in the panel when the capsule already carries it", () => {
    const state = diverRowState(
      diver({
        boardedEarlier: true,
        readiness: { status: "blocked", blockers: [{ code: "medical_review" }] },
      }),
      "after_dive_2",
      false,
      "America/New_York",
    );
    expect(state.capsuleKind).toBe("medicalHold");
    expect(state.medicalHoldInPanel).toBeNull();
  });
});

describe("diverRowState's gate", () => {
  it("holds a blocked diver at the dock and offers no tap", () => {
    const state = diverRowState(
      diver({ readiness: blocked }),
      "departure",
      true,
      "America/New_York",
    );
    expect(state.blockedAtDock).toBe(true);
    expect(state.boardingControlShown).toBe(false);
  });

  it("gates nothing after a dive for a diver counted aboard earlier", () => {
    const state = diverRowState(
      diver({ readiness: blocked, boardedEarlier: true }),
      "after_dive_1",
      false,
      "America/New_York",
    );
    expect(state.blockedAtDock).toBe(false);
    expect(state.boardingControlShown).toBe(true);
  });

  it("reads a diver boarding at the second site as the dock would, and keeps the tap", () => {
    const state = diverRowState(
      diver({ readiness: blocked, boardedEarlier: false, rollCall: boardedAt() }),
      "after_dive_1",
      false,
      "America/New_York",
    );
    expect(state.blockedAtDock).toBe(true);
    expect(state.boardingControlShown).toBe(true);
  });
});

/**
 * **The desk's check-in on the dock row** (fourth review, item 15). The
 * gangway's question is who is still to come; the desk already answered it for
 * the divers it checked in. Only at the dock, only until the crew records its
 * own word, and never for a seat the desk wrote off.
 */
describe("diverRowState's desk check-in", () => {
  const zone = "America/New_York";

  it("says it at the dock for a checked-in diver the crew has not called", () => {
    expect(diverRowState(diver({ checkedIn: true }), "departure", true, zone).checkedInAtDesk).toBe(
      true,
    );
  });

  it("gives way to the crew's own word once the diver is boarded", () => {
    expect(
      diverRowState(diver({ checkedIn: true, rollCall: boardedAt() }), "departure", true, zone)
        .checkedInAtDesk,
    ).toBe(false);
  });

  it("is not said after a dive, where the desk's word is history", () => {
    expect(
      diverRowState(diver({ checkedIn: true }), "after_dive_1", false, zone).checkedInAtDesk,
    ).toBe(false);
  });

  it("is not said for a diver the desk did not check in, or wrote off", () => {
    expect(diverRowState(diver(), "departure", true, zone).checkedInAtDesk).toBe(false);
    expect(
      diverRowState(diver({ checkedIn: true, notHere: true }), "departure", true, zone)
        .checkedInAtDesk,
    ).toBe(false);
  });
});
