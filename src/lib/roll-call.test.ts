import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blockedAtRail,
  boardedBefore,
  cancelledRollCall,
  carryForwardNotBoarded,
  isNotBackAboard,
  isRollCallCheckpoint,
  medicalHoldAfterDive,
  RETRACTION_SUPERSEDED,
  ROLL_CALL_NOTE_MAX,
  type RollCallCheckpoint,
  type RollCallRecord,
  rollCallCheckpointOrdinal,
  rollCallCheckpoints,
  rollCallNoteAllowed,
} from "./roll-call";

const standing = (
  state: RollCallRecord["state"],
  implied?: boolean,
): Pick<RollCallRecord, "state" | "implied"> =>
  implied === undefined ? { state } : { state, implied };

const AFTER_DIVE: RollCallCheckpoint = "after_dive_1";

/**
 * The rule behind ADR 20260828-a-missing-diver-gets-a-sentence: a note may
 * accompany the statement that somebody is unaccounted for, or the unsaying of
 * one — and nothing else. Every branch is a safety-surface decision, so each
 * one is pinned on its own rather than inferred from the manifest assembly.
 */
describe("rollCallNoteAllowed", () => {
  it("never allows a note at departure, whatever the status or standing result", () => {
    for (const status of ["boarded", "not_boarded", "cleared"] as const) {
      expect(rollCallNoteAllowed("departure", status, undefined)).toBe(false);
      expect(rollCallNoteAllowed("departure", status, standing("not_boarded"))).toBe(false);
      expect(rollCallNoteAllowed("departure", status, standing("boarded"))).toBe(false);
    }
  });

  it("allows a note when raising the alarm after a dive, with no read of the standing result", () => {
    expect(rollCallNoteAllowed(AFTER_DIVE, "not_boarded", undefined)).toBe(true);
    expect(rollCallNoteAllowed(AFTER_DIVE, "not_boarded", standing("boarded"))).toBe(true);
    // Even when the diver is already stated missing — a second sentence is still a sentence.
    expect(rollCallNoteAllowed(AFTER_DIVE, "not_boarded", standing("not_boarded"))).toBe(true);
  });

  it("allows a note on the positive sighting that unsays a standing alarm", () => {
    expect(rollCallNoteAllowed(AFTER_DIVE, "boarded", standing("not_boarded"))).toBe(true);
    expect(rollCallNoteAllowed(AFTER_DIVE, "boarded", standing("not_boarded", false))).toBe(true);
  });

  it("allows a note on the mis-tap undo of a standing alarm", () => {
    expect(rollCallNoteAllowed(AFTER_DIVE, "cleared", standing("not_boarded"))).toBe(true);
  });

  it("refuses a note on an ordinary 'came back' — nothing stands to unsay", () => {
    expect(rollCallNoteAllowed(AFTER_DIVE, "boarded", undefined)).toBe(false);
    expect(rollCallNoteAllowed(AFTER_DIVE, "boarded", standing("boarded"))).toBe(false);
    expect(rollCallNoteAllowed(AFTER_DIVE, "cleared", undefined)).toBe(false);
    expect(rollCallNoteAllowed(AFTER_DIVE, "cleared", standing("boarded"))).toBe(false);
  });

  it("refuses a note when the standing not-boarded is only carried forward from the dock", () => {
    // "Never left" re-read at a later checkpoint is not an alarm to unsay.
    expect(rollCallNoteAllowed(AFTER_DIVE, "boarded", standing("not_boarded", true))).toBe(false);
    expect(rollCallNoteAllowed(AFTER_DIVE, "cleared", standing("not_boarded", true))).toBe(false);
  });

  it("holds at every after-dive checkpoint the trip can have, not only the first", () => {
    for (const checkpoint of rollCallCheckpoints(4)) {
      const expected = checkpoint !== "departure";
      expect(rollCallNoteAllowed(checkpoint, "not_boarded", undefined)).toBe(expected);
      expect(rollCallNoteAllowed(checkpoint, "boarded", standing("not_boarded"))).toBe(expected);
    }
  });

  it("agrees with isNotBackAboard on when a standing result is an alarm", () => {
    const cases: Array<Pick<RollCallRecord, "state" | "implied"> | undefined> = [
      undefined,
      standing("boarded"),
      standing("not_boarded"),
      standing("not_boarded", true),
      standing("not_boarded", false),
    ];
    for (const checkpoint of rollCallCheckpoints(2)) {
      for (const result of cases) {
        expect(rollCallNoteAllowed(checkpoint, "boarded", result)).toBe(
          isNotBackAboard(checkpoint, result),
        );
      }
    }
  });

  it("refuses a note on the carried default that carryForwardNotBoarded itself produces", () => {
    const [, carried] = carryForwardNotBoarded([standing("not_boarded"), undefined]);
    expect(carried).toEqual({ state: "not_boarded", implied: true });
    expect(rollCallNoteAllowed(AFTER_DIVE, "boarded", carried)).toBe(false);
  });
});

describe("a five-dive course session", () => {
  it("retains an independent roll call after every planned dive", () => {
    expect(rollCallCheckpoints(5)).toEqual([
      "departure",
      "after_dive_1",
      "after_dive_2",
      "after_dive_3",
      "after_dive_4",
      "after_dive_5",
    ]);
    expect(isRollCallCheckpoint("after_dive_5", 5)).toBe(true);
    expect(isRollCallCheckpoint("after_dive_6", 5)).toBe(false);
    expect(isNotBackAboard("after_dive_5", standing("not_boarded"))).toBe(true);
  });
});

describe("the shared constants", () => {
  it("bounds a note to a sentence, not an essay", () => {
    expect(ROLL_CALL_NOTE_MAX).toBe(300);
  });

  it("spells the superseded-retraction refusal the way the database column stores reasons", () => {
    expect(RETRACTION_SUPERSEDED).toBe("retraction_superseded");
    expect(RETRACTION_SUPERSEDED).toMatch(/^[a-z_]+$/);
  });
});

/**
 * The header of `roll-call.ts` says why it imports nothing: it is compiled into
 * the offline service worker, and one value import reaching `node:crypto`
 * breaks that build with no test on either side turning red. `tsc` cannot
 * see that constraint, so it is pinned here by reading the source.
 */
describe("the bundling constraint", () => {
  it("imports nothing at all", () => {
    const source = readFileSync(new URL("./roll-call.ts", import.meta.url), "utf8");
    const imports = source
      .split("\n")
      .filter((line) => /^\s*(import|export)\b.*\bfrom\s+["']/.test(line))
      .filter((line) => !line.trimStart().startsWith("*"));
    expect(imports).toEqual([]);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});

/**
 * **Where readiness still speaks on a roll-call row** (domain review of #2123;
 * issue #2286): at the dock always, and after a dive only for someone whose
 * `boarded` there would be their first. The live manifest and the offline copy
 * both read this one predicate.
 */
describe("blockedAtRail", () => {
  it("never marks a ready person", () => {
    for (const isDeparture of [true, false]) {
      for (const boardedEarlier of [true, false, undefined]) {
        expect(
          blockedAtRail({ ready: true, isDeparture, boardedEarlier, notBackAboard: false }),
        ).toBe(false);
      }
    }
  });

  it("marks a blocked person at the dock whatever came before", () => {
    expect(blockedAtRail({ ready: false, isDeparture: true, notBackAboard: false })).toBe(true);
    expect(
      blockedAtRail({
        ready: false,
        isDeparture: true,
        boardedEarlier: true,
        notBackAboard: false,
      }),
    ).toBe(true);
  });

  it("marks a blocked person after a dive only when nobody boarded them earlier", () => {
    expect(
      blockedAtRail({
        ready: false,
        isDeparture: false,
        boardedEarlier: false,
        notBackAboard: false,
      }),
    ).toBe(true);
    expect(
      blockedAtRail({
        ready: false,
        isDeparture: false,
        boardedEarlier: true,
        notBackAboard: false,
      }),
    ).toBe(false);
    // Absent fails toward the blocker: a row that cannot say whether anyone
    // boarded them keeps it in view.
    expect(blockedAtRail({ ready: false, isDeparture: false, notBackAboard: false })).toBe(true);
  });

  it("never puts a paperwork word on a row recorded not back aboard", () => {
    expect(
      blockedAtRail({
        ready: false,
        isDeparture: false,
        boardedEarlier: false,
        notBackAboard: true,
      }),
    ).toBe(false);
  });
});

/**
 * **A medical "no" stays on the row between dives** (issue #2380, Aaron's
 * decision (b)). `blockedAtRail` stops speaking readiness after a dive for a
 * diver boarded over the block (decision 4); a medical blocker is not
 * paperwork, so it keeps a warning-toned capsule there instead — never the
 * danger "Blocked", which the not-back alarm keeps for itself.
 */
describe("medicalHoldAfterDive", () => {
  const afterDives: RollCallCheckpoint[] = ["after_dive_1", "after_dive_2", "after_dive_3"];

  it("names a physician's no at every after-dive checkpoint for a diver boarded over it", () => {
    for (const checkpoint of afterDives) {
      expect(
        medicalHoldAfterDive({
          checkpoint,
          boardedEarlier: true,
          notBackAboard: false,
          blockerCodes: ["medical_not_cleared"],
        }),
      ).toBe("medical_not_cleared");
    }
  });

  it("names an open medical review the same way", () => {
    for (const checkpoint of afterDives) {
      expect(
        medicalHoldAfterDive({
          checkpoint,
          boardedEarlier: true,
          notBackAboard: false,
          blockerCodes: ["waiver_missing", "medical_review"],
        }),
      ).toBe("medical_review");
    }
  });

  it("puts the physician's no ahead of an open review when both stand", () => {
    expect(
      medicalHoldAfterDive({
        checkpoint: AFTER_DIVE,
        boardedEarlier: true,
        notBackAboard: false,
        blockerCodes: ["medical_review", "medical_not_cleared"],
      }),
    ).toBe("medical_not_cleared");
  });

  it("says nothing at the dock, where the row already says Blocked", () => {
    expect(
      medicalHoldAfterDive({
        checkpoint: "departure",
        boardedEarlier: true,
        notBackAboard: false,
        blockerCodes: ["medical_not_cleared"],
      }),
    ).toBeNull();
  });

  it("says nothing for a diver nobody boarded earlier, whose row still says Blocked", () => {
    for (const boardedEarlier of [false, undefined]) {
      const input = {
        checkpoint: AFTER_DIVE,
        boardedEarlier,
        notBackAboard: false,
        blockerCodes: ["medical_not_cleared"],
      };
      expect(medicalHoldAfterDive(input)).toBeNull();
      // The two predicates never both stay quiet on a medical block.
      expect(blockedAtRail({ ready: false, isDeparture: false, ...input })).toBe(true);
    }
  });

  it("lets the not-back alarm win: nothing beside somebody in the water", () => {
    expect(
      medicalHoldAfterDive({
        checkpoint: AFTER_DIVE,
        boardedEarlier: true,
        notBackAboard: true,
        blockerCodes: ["medical_not_cleared"],
      }),
    ).toBeNull();
  });

  it("stays quiet for a paperwork blocker, which decision 4 keeps off the rail", () => {
    for (const code of ["waiver_missing", "cert_unverified", "readiness_unavailable"]) {
      expect(
        medicalHoldAfterDive({
          checkpoint: AFTER_DIVE,
          boardedEarlier: true,
          notBackAboard: false,
          blockerCodes: [code],
        }),
      ).toBeNull();
    }
    expect(
      medicalHoldAfterDive({
        checkpoint: AFTER_DIVE,
        boardedEarlier: true,
        notBackAboard: false,
        blockerCodes: [],
      }),
    ).toBeNull();
  });

  /**
   * **A missing mark is not carried, so the hold comes back** (#2380 review).
   * Only the dock's not-boarded carries forward; a not-back at after_dive_1
   * leaves after_dive_2 awaiting. That awaiting row is no alarm, and the diver
   * boarded at the dock, so it wears the hold again. Pinned as it stands.
   */
  it("wears the hold on the awaiting row after a not-back nobody has touched since", () => {
    const checkpoints: RollCallCheckpoint[] = ["departure", "after_dive_1", "after_dive_2"];
    const effective = carryForwardNotBoarded([standing("boarded"), standing("not_boarded")]);
    const at = (index: number) => {
      const checkpoint = checkpoints[index] as RollCallCheckpoint;
      return medicalHoldAfterDive({
        checkpoint,
        boardedEarlier: boardedBefore(effective.slice(0, index)),
        notBackAboard: isNotBackAboard(checkpoint, effective[index]),
        blockerCodes: ["medical_not_cleared"],
      });
    };
    // The alarm at after_dive_1 carries nothing else.
    expect(at(1)).toBeNull();
    expect(effective[2]).toBeUndefined();
    expect(at(2)).toBe("medical_not_cleared");
  });

  it("leaves blockedAtRail's answer for the same diver unchanged (decision 4)", () => {
    expect(
      blockedAtRail({
        ready: false,
        isDeparture: false,
        boardedEarlier: true,
        notBackAboard: false,
      }),
    ).toBe(false);
  });
});

describe("rollCallCheckpointOrdinal", () => {
  it("orders the dock before every dive, and dives by number", () => {
    expect(
      (["after_dive_2", "departure", "after_dive_1"] as const)
        .slice()
        .sort((a, b) => rollCallCheckpointOrdinal(a) - rollCallCheckpointOrdinal(b)),
    ).toEqual(["departure", "after_dive_1", "after_dive_2"]);
  });
});

describe("boardedBefore", () => {
  it("reads a standing boarded result at any earlier checkpoint", () => {
    expect(boardedBefore([])).toBe(false);
    expect(boardedBefore([undefined, null])).toBe(false);
    expect(boardedBefore([standing("not_boarded"), standing("not_boarded", true)])).toBe(false);
    expect(boardedBefore([standing("not_boarded"), standing("boarded")])).toBe(true);
  });
});

describe("cancelledRollCall (#2285)", () => {
  it("says nothing on a departure that is not cancelled", () => {
    expect(cancelledRollCall({ cancelled: false, rollCallOpen: true })).toBeNull();
  });

  it("closes the roll call of a cancelled departure nobody counted on", () => {
    expect(cancelledRollCall({ cancelled: true, rollCallOpen: false })).toBe("closed");
  });

  it("keeps a cancelled departure's count open once it has begun", () => {
    expect(cancelledRollCall({ cancelled: true, rollCallOpen: true })).toBe("still_counting");
  });

  it("never closes a departure that is not cancelled, whatever the writers say", () => {
    // Only a cancellation closes a page: a scheduled trip whose gate read
    // false (a stale read) keeps its controls, and the writer answers.
    expect(cancelledRollCall({ cancelled: false, rollCallOpen: false })).toBeNull();
  });
});
