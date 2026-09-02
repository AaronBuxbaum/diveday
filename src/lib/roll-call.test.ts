import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  carryForwardNotBoarded,
  isNotBackAboard,
  RETRACTION_SUPERSEDED,
  ROLL_CALL_NOTE_MAX,
  type RollCallCheckpoint,
  type RollCallRecord,
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
