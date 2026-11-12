import { describe, expect, it } from "vitest";
import { foldRollCallEvidence, type RollCallEvidence } from "./roll-call-causality";

const aboard = (id: string, observed?: string[]): RollCallEvidence => ({
  id,
  status: "boarded",
  observed,
});
const missing = (id: string, observed?: string[]): RollCallEvidence => ({
  id,
  status: "not_boarded",
  observed,
});

describe("causal roll-call evidence", () => {
  it.each([
    "accurate delayed request",
    "fast clock late sync",
    "slow clock missing",
    "clock changed before send",
  ])("keeps opposing unobserved evidence for %s, in either delivery order", () => {
    for (const evidence of [
      [aboard("a", []), missing("m", [])],
      [missing("m", []), aboard("a", [])],
    ]) {
      expect(foldRollCallEvidence(evidence, "after_dive_1")).toMatchObject({
        status: "not_boarded",
        conflict: true,
        frontier: expect.arrayContaining(["a", "m"]),
      });
    }
  });

  it("merges concurrent compatible statements automatically", () => {
    expect(foldRollCallEvidence([aboard("a", []), aboard("b", [])], "after_dive_1")).toMatchObject({
      status: "boarded",
      conflict: false,
      frontier: ["a", "b"],
    });
  });

  it("keeps observed ordinary corrections and named undo frictionless", () => {
    const evidence = [
      missing("a", []),
      aboard("b", ["a"]),
      { id: "c", status: "cleared" as const, observed: ["b"], retracts: "b" },
    ];
    expect(foldRollCallEvidence(evidence, "after_dive_1")).toMatchObject({
      status: "cleared",
      conflict: false,
      frontier: ["c"],
    });
  });

  it("folds prior queued local events by dependency even when delivery is reordered", () => {
    const evidence = [aboard("c", ["b"]), missing("b", ["a"]), aboard("a", [])];
    expect(foldRollCallEvidence(evidence, "after_dive_1")).toMatchObject({
      status: "boarded",
      conflict: false,
      frontier: ["c"],
    });
  });

  it("does not let an ordinary tap silently reconcile conflicting evidence", () => {
    const evidence = [aboard("a", []), missing("m", []), aboard("c", ["a", "m"])];
    expect(foldRollCallEvidence(evidence, "after_dive_1")).toMatchObject({
      status: "not_boarded",
      conflict: true,
    });
  });

  it("cannot launder an unconfirmed conflict through a later ordinary correction", () => {
    const evidence = [
      aboard("a", []),
      missing("m", []),
      aboard("c", ["a", "m"]),
      aboard("d", ["c"]),
    ];
    expect(foldRollCallEvidence(evidence, "after_dive_1")).toMatchObject({
      status: "not_boarded",
      conflict: true,
    });
  });

  it("allows explicit reconciliation naming all conflicting evidence", () => {
    const evidence = [
      aboard("a", []),
      missing("m", []),
      { ...aboard("c", ["a", "m"]), reconciles: true },
    ];
    expect(foldRollCallEvidence(evidence, "after_dive_1")).toMatchObject({
      status: "boarded",
      conflict: false,
      frontier: ["c"],
    });
  });

  it("keeps a newly arrived unobserved missing statement after reconciliation", () => {
    const evidence = [
      aboard("a", []),
      missing("m", []),
      { ...aboard("c", ["a", "m"]), reconciles: true },
      missing("late", []),
    ];
    expect(foldRollCallEvidence(evidence, "after_dive_1")).toMatchObject({
      status: "not_boarded",
      conflict: true,
      frontier: ["c", "late"],
    });
  });

  it("retains older saved/queued evidence without causal context conservatively", () => {
    expect(
      foldRollCallEvidence([aboard("legacy-a"), missing("legacy-m")], "after_dive_1"),
    ).toMatchObject({ status: "not_boarded", conflict: true });
    expect(
      foldRollCallEvidence([missing("legacy-m"), missing("new-m", [])], "after_dive_1"),
    ).toMatchObject({ status: "not_boarded", conflict: false });
  });

  it("does not duplicate a retried event or infer causality from array order", () => {
    const evidence = [aboard("a", []), missing("m", []), aboard("a", [])];
    expect(foldRollCallEvidence(evidence, "after_dive_1")).toMatchObject({
      status: "not_boarded",
      conflict: true,
      frontier: ["a", "m"],
    });
  });

  it("honors a validated older retraction without unsaying other missing evidence", () => {
    const undo = { id: "undo", status: "cleared" as const, retracts: "m" };
    expect(foldRollCallEvidence([missing("m"), undo], "after_dive_1")).toMatchObject({
      status: "cleared",
      conflict: false,
      frontier: ["undo"],
    });
    expect(
      foldRollCallEvidence([missing("m"), missing("other"), undo], "after_dive_1"),
    ).toMatchObject({ status: "not_boarded", conflict: false, frontier: ["other", "undo"] });
  });

  it("preserves corrupted cyclic evidence rather than erasing every statement", () => {
    expect(
      foldRollCallEvidence([missing("m", ["a"]), aboard("a", ["m"])], "after_dive_1"),
    ).toMatchObject({ status: "not_boarded", conflict: true, frontier: ["a", "m"] });
  });

  it("does not let later context launder a corrupt cycle into observation", () => {
    expect(
      foldRollCallEvidence(
        [missing("m", ["a"]), aboard("a", ["m"]), aboard("later", ["a"])],
        "after_dive_1",
      ),
    ).toMatchObject({ status: "not_boarded", conflict: true });
  });

  it("an undo of one compatible statement never takes back another crew member's statement", () => {
    expect(
      foldRollCallEvidence(
        [
          aboard("a", []),
          aboard("b", []),
          { id: "undo", status: "cleared", observed: ["a", "b"], retracts: "a" },
        ],
        "after_dive_1",
      ),
    ).toMatchObject({ status: "boarded", conflict: false, frontier: ["b", "undo"] });
  });

  it("never grants an ashore exemption from conflicting dock evidence", () => {
    expect(foldRollCallEvidence([aboard("a", []), missing("m", [])], "departure")).toMatchObject({
      status: "boarded",
      conflict: true,
    });
  });
});
