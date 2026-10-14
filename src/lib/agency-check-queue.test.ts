import { describe, expect, it } from "vitest";
import {
  AGENCY_CHECK_QUEUE_PAUSE_MS,
  type AgencyCheckOutcome,
  agencyCheckQueueCards,
  runAgencyCheckQueue,
  stopsAgencyCheckQueue,
} from "./agency-check-queue";

type Card = { certificationId: string };

function cards(...ids: string[]): Card[] {
  return ids.map((certificationId) => ({ certificationId }));
}

/**
 * A run against scripted outcomes, recording the order of every check and
 * pause so the tests can say what happened between them.
 */
async function run(
  input: Card[],
  outcomes: Record<string, AgencyCheckOutcome | Error>,
  options: { cancelAfter?: number } = {},
) {
  const log: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const summary = await runAgencyCheckQueue({
    cards: input,
    check: async (card) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`check ${card.certificationId}`);
      await Promise.resolve();
      inFlight -= 1;
      const outcome = outcomes[card.certificationId] ?? "match";
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    pause: async (ms) => {
      log.push(`pause ${ms}`);
    },
    onSettle: (card, outcome, done) =>
      log.push(`settle ${card.certificationId} ${outcome} ${done}`),
    cancelled: () =>
      options.cancelAfter !== undefined &&
      log.filter((line) => line.startsWith("settle")).length >= options.cancelAfter,
  });
  return { summary, log, maxInFlight };
}

describe("runAgencyCheckQueue", () => {
  it("checks one card at a time, pausing between each and never before the first", async () => {
    const { summary, log, maxInFlight } = await run(cards("a", "b", "c"), {});

    expect(maxInFlight).toBe(1);
    expect(log).toEqual([
      "check a",
      "settle a match 1",
      `pause ${AGENCY_CHECK_QUEUE_PAUSE_MS}`,
      "check b",
      "settle b match 2",
      `pause ${AGENCY_CHECK_QUEUE_PAUSE_MS}`,
      "check c",
      "settle c match 3",
    ]);
    expect(summary).toEqual({ checked: 3, certified: 3, stopped: null, cancelled: false });
  });

  it("goes on past anything short of a match that is still a readable answer", async () => {
    const { summary } = await run(cards("a", "b", "c", "d"), {
      a: "level_unconfirmed",
      b: "no_record",
      c: "refused",
    });

    expect(summary).toEqual({ checked: 4, certified: 1, stopped: null, cancelled: false });
  });

  it("stops on the first page it cannot read and leaves the rest unchecked", async () => {
    const { summary, log } = await run(cards("a", "b", "c"), { b: "unreadable" });

    expect(summary.checked).toBe(2);
    expect(summary.certified).toBe(1);
    expect(summary.stopped).toEqual({ card: { certificationId: "b" }, outcome: "unreadable" });
    expect(log).not.toContain("check c");
    // No pause after the stop: nothing else is coming.
    expect(log.at(-1)).toBe("settle b unreadable 2");
  });

  it("stops on a transport failure, including a check that throws", async () => {
    const reported = await run(cards("a", "b"), { a: "transport" });
    expect(reported.summary.stopped?.outcome).toBe("transport");
    expect(reported.log).not.toContain("check b");

    const thrown = await run(cards("a", "b"), { a: new Error("network") });
    expect(thrown.summary.stopped).toEqual({
      card: { certificationId: "a" },
      outcome: "transport",
    });
    expect(thrown.log).not.toContain("check b");
  });

  it("checks each card once, however often the list names it", async () => {
    const { log } = await run(cards("a", "a", "b"), {});
    expect(log.filter((line) => line.startsWith("check"))).toEqual(["check a", "check b"]);
  });

  it("stops asking once the page goes away", async () => {
    const { summary, log } = await run(cards("a", "b", "c"), {}, { cancelAfter: 1 });
    expect(summary).toEqual({ checked: 1, certified: 1, stopped: null, cancelled: true });
    expect(log).not.toContain("check b");
  });

  it("does nothing for an empty departure", async () => {
    const { summary, log } = await run([], {});
    expect(summary).toEqual({ checked: 0, certified: 0, stopped: null, cancelled: false });
    expect(log).toEqual([]);
  });
});

describe("stopsAgencyCheckQueue", () => {
  it("stops only on an unreadable page or a transport failure", () => {
    const stops = (
      ["match", "level_unconfirmed", "no_record", "unreadable", "transport", "refused"] as const
    ).filter(stopsAgencyCheckQueue);
    expect(stops).toEqual(["unreadable", "transport"]);
  });
});

describe("agencyCheckQueueCards", () => {
  it("keeps the given order and adds nothing", () => {
    expect(agencyCheckQueueCards(cards("c", "a", "c", "b"))).toEqual(cards("c", "a", "b"));
  });
});
