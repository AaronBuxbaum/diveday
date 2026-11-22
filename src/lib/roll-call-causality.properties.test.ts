/**
 * Properties of `foldRollCallEvidence`, `causalReplayOrder` and
 * `rollCallIntentKey` (src/lib/roll-call-causality.ts): roll-call statements
 * merge by tap-observed evidence (ADR 20261112-roll-call-observes-evidence).
 * Example tests: roll-call-causality.test.ts.
 *
 * Not stated here: "shifting every clock by a constant changes nothing". A
 * `RollCallEvidence` carries no timestamp at all, so the fold cannot read one;
 * the type pins that rule, and a property over it could never fail.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { property } from "@/test/property";
import {
  causalReplayOrder,
  clientRollCallEvidenceId,
  foldRollCallEvidence,
  type RollCallEvidence,
  rollCallIntentKey,
} from "./roll-call-causality";

const IDS = ["a", "b", "c", "d", "e", "f"];
const arbCheckpoint = fc.constantFrom("departure", "after_dive_1", "after_dive_2");
const arbStatus = fc.constantFrom<RollCallEvidence["status"]>("boarded", "not_boarded", "cleared");

/**
 * A scope's evidence: up to six statements, each observing any other ids
 * (cycles, self-reference and unknown ids included, as corrupt context
 * could), or nothing recorded at all, and maybe reconciling or retracting.
 */
const arbEvidence: fc.Arbitrary<RollCallEvidence[]> = fc
  .integer({ min: 1, max: IDS.length })
  .chain((count) =>
    fc.tuple(
      ...IDS.slice(0, count).map((id) =>
        fc.record({
          id: fc.constant(id),
          status: arbStatus,
          observed: fc.option(fc.subarray([...IDS.slice(0, count), "zz"]), { nil: undefined }),
          reconciles: fc.boolean(),
          retracts: fc.option(fc.constantFrom(...IDS.slice(0, count)), { nil: undefined }),
        }),
      ),
    ),
  )
  .map((items) => items as RollCallEvidence[]);

/** The evidence in some delivery order, with some statements delivered more than once. */
const arbDelivery = arbEvidence.chain((evidence) =>
  fc.tuple(
    fc.constant(evidence),
    fc.array(fc.constantFrom(...evidence), { maxLength: 4 }).chain((repeats) =>
      fc.shuffledSubarray([...evidence, ...repeats], {
        minLength: evidence.length + repeats.length,
      }),
    ),
  ),
);

describe("foldRollCallEvidence", () => {
  /**
   * Converges in any order: whatever order the statements arrive in, and
   * however many times one is delivered again, the projection is the same.
   */
  property(
    "is independent of delivery order and repeats",
    [arbDelivery, arbCheckpoint],
    ([evidence, delivered], checkpoint) => {
      expect(foldRollCallEvidence(delivered, checkpoint)).toEqual(
        foldRollCallEvidence(evidence, checkpoint),
      );
    },
    { runs: 500 },
  );

  /**
   * An actual conflict is reported, never picked: aboard and missing
   * statements nobody observed together stay a conflict that does not count
   * as accounted for, and an ordinary tap observing both does not end it.
   */
  property(
    "opposing unobserved statements stay a conflict until reconciled",
    [
      arbCheckpoint,
      fc.constantFrom<RollCallEvidence["status"]>("boarded", "not_boarded"),
      fc.boolean(),
    ],
    (checkpoint, later, reconciles) => {
      const evidence: RollCallEvidence[] = [
        { id: "a", status: "boarded", observed: [] },
        { id: "m", status: "not_boarded", observed: [] },
        { id: "t", status: later, observed: ["a", "m"], reconciles },
      ];
      const projection = foldRollCallEvidence(evidence, checkpoint);
      expect(projection.conflict).toBe(!reconciles);
      if (reconciles) expect(projection.status).toBe(later);
      else expect(projection.accountedFor).toBe(false);
    },
  );

  /** Compatible concurrent statements merge automatically into their shared status. */
  property(
    "agreeing concurrent statements merge without conflict",
    [
      arbCheckpoint,
      fc.constantFrom<RollCallEvidence["status"]>("boarded", "not_boarded"),
      fc.integer({ min: 1, max: 5 }),
    ],
    (checkpoint, status, count) => {
      const evidence = IDS.slice(0, count).map((id) => ({ id, status, observed: [] }));
      const projection = foldRollCallEvidence(evidence, checkpoint);
      expect(projection).toMatchObject({ status, conflict: false });
      expect(projection.frontier).toHaveLength(count);
    },
  );
});

describe("foldRollCallEvidence accounting", () => {
  /**
   * A person counts as accounted for only on an unconflicted, positive
   * reading: never in a conflict, never on a withdrawn ("cleared") or empty
   * result, and after a dive only when the reading is aboard.
   */
  property(
    "accounted for means unconflicted, stated, and aboard after a dive",
    [arbEvidence, arbCheckpoint],
    (evidence, checkpoint) => {
      const projection = foldRollCallEvidence(evidence, checkpoint);
      if (!projection.accountedFor) return;
      expect(projection.conflict).toBe(false);
      expect(projection.status === null || projection.status === "cleared").toBe(false);
      if (checkpoint !== "departure") expect(projection.status).toBe("boarded");
    },
    { runs: 500 },
  );

  /**
   * Opposing evidence is never silently resolved: a frontier that still holds
   * both an aboard and a not-aboard statement is a conflict and is not
   * accounted for.
   */
  property(
    "a frontier holding aboard and not aboard is a conflict",
    [arbEvidence, arbCheckpoint],
    (evidence, checkpoint) => {
      const projection = foldRollCallEvidence(evidence, checkpoint);
      const statuses = new Set(
        projection.frontier.map((id) => evidence.find((item) => item.id === id)?.status),
      );
      if (statuses.has("boarded") && statuses.has("not_boarded")) {
        expect(projection.conflict).toBe(true);
        expect(projection.accountedFor).toBe(false);
      }
    },
    { runs: 500 },
  );
});

describe("causalReplayOrder", () => {
  /**
   * However a queue is stored, replay keeps every event exactly once and puts
   * each event after the queued events it observed (for a queue with no
   * cycles), independently of any capture clock.
   */
  property(
    "replays every event once, dependencies first",
    [
      fc
        .integer({ min: 1, max: IDS.length })
        .chain((count) =>
          fc.tuple(...IDS.slice(0, count).map((_, index) => fc.subarray(IDS.slice(0, index)))),
        )
        .chain((observedByIndex) =>
          fc.shuffledSubarray(
            observedByIndex.map((observed, index) => ({
              clientEventId: IDS[index] as string,
              observedEvidenceIds: observed.map(clientRollCallEvidenceId),
            })),
            { minLength: observedByIndex.length },
          ),
        ),
    ],
    (queue) => {
      const order = causalReplayOrder(queue);
      expect([...order].sort((x, y) => x.clientEventId.localeCompare(y.clientEventId))).toEqual(
        [...queue].sort((x, y) => x.clientEventId.localeCompare(y.clientEventId)),
      );
      const position = new Map(
        order.map((event, index) => [clientRollCallEvidenceId(event.clientEventId), index]),
      );
      order.forEach((event, index) => {
        for (const id of event.observedEvidenceIds) {
          expect(position.get(id) ?? -1).toBeLessThan(index);
        }
      });
    },
  );
});

describe("rollCallIntentKey", () => {
  /**
   * A retry of the same tap names the same intent: the order, repetition and
   * letter case of its observed ids never change its key, so an idempotent
   * repeat is recognized as the same statement.
   */
  property(
    "is blind to the order, repeats and case of observed ids",
    [arbStatus, fc.uniqueArray(fc.uuid(), { maxLength: 4 }), fc.boolean(), fc.nat(3)],
    (status, observed, reconcilesEvidence, meetingDay) => {
      const intent = { status, observedEvidenceIds: observed, reconcilesEvidence, meetingDay };
      const retry = {
        ...intent,
        observedEvidenceIds: [...observed, ...observed].reverse().map((id) => id.toUpperCase()),
      };
      expect(rollCallIntentKey(retry)).toBe(rollCallIntentKey(intent));
    },
  );
});
