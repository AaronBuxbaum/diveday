import { describe, expect, it } from "vitest";
import {
  AGENCY_CHECK_QUEUE_PAUSE_MS,
  type AgencyCheckOutcome,
  agencyCheckQueueCards,
  isUnreadableOutcome,
  leavesAgencyCards,
  runAgencyCheckQueue,
  stopsAgencyCheckQueue,
} from "./agency-check-queue";

type Card = { certificationId: string; agency?: string };

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
      const outcome = outcomes[card.certificationId] ?? "certified";
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
      "settle a certified 1",
      `pause ${AGENCY_CHECK_QUEUE_PAUSE_MS}`,
      "check b",
      "settle b certified 2",
      `pause ${AGENCY_CHECK_QUEUE_PAUSE_MS}`,
      "check c",
      "settle c certified 3",
    ]);
    expect(summary).toEqual({
      checked: 3,
      certified: 3,
      confirmed: 0,
      stopped: null,
      cancelled: false,
      left: [],
    });
  });

  it("goes on past anything short of a match that is still a readable answer", async () => {
    const { summary } = await run(cards("a", "b", "c", "d"), {
      a: "level_unconfirmed",
      b: "no_record",
      c: "refused",
    });

    expect(summary).toEqual({
      checked: 4,
      certified: 1,
      confirmed: 0,
      stopped: null,
      cancelled: false,
      left: [],
    });
  });

  it("counts an imported card the agency confirmed apart from one it certified", async () => {
    const { summary } = await run(cards("a", "b", "c"), { b: "confirmed" });
    expect(summary).toMatchObject({ checked: 3, certified: 2, confirmed: 1, stopped: null });
  });

  /**
   * One diver the agency's page does not show cleanly is that diver's, not the
   * page's: the run skips them and goes on. Two in a row is the page (a
   * captcha, a redesign), and the run stops there rather than hammer it.
   */
  it("skips a single unreadable result and goes on", async () => {
    const { summary, log } = await run(cards("a", "b", "c", "d"), { b: "unreadable" });

    expect(summary).toEqual({
      checked: 4,
      certified: 3,
      confirmed: 0,
      stopped: null,
      cancelled: false,
      left: [],
    });
    expect(log).toContain("check c");
  });

  it("skips unreadable results that are not consecutive", async () => {
    const { summary } = await run(cards("a", "b", "c", "d"), { a: "unreadable", c: "transport" });
    expect(summary.stopped).toBeNull();
    expect(summary.checked).toBe(4);
  });

  it("stops on the second unreadable result in a row and leaves the rest unchecked", async () => {
    const { summary, log } = await run(cards("a", "b", "c", "d"), {
      b: "unreadable",
      c: "unreadable",
    });

    expect(summary.checked).toBe(3);
    expect(summary.certified).toBe(1);
    expect(summary.stopped).toEqual({ card: { certificationId: "c" }, outcome: "unreadable" });
    expect(log).not.toContain("check d");
    // No pause after the stop: nothing else is coming.
    expect(log.at(-1)).toBe("settle c unreadable 3");
  });

  it("counts a transport failure, including a check that throws, toward the two in a row", async () => {
    const reported = await run(cards("a", "b", "c"), { a: "unreadable", b: "transport" });
    expect(reported.summary.stopped).toEqual({
      card: { certificationId: "b" },
      outcome: "transport",
    });
    expect(reported.log).not.toContain("check c");

    const thrown = await run(cards("a", "b", "c"), {
      a: new Error("network"),
      b: new Error("network"),
    });
    expect(thrown.summary.stopped).toEqual({
      card: { certificationId: "b" },
      outcome: "transport",
    });
    expect(thrown.log).not.toContain("check c");

    const once = await run(cards("a", "b"), { a: new Error("network") });
    expect(once.summary.stopped).toBeNull();
    expect(once.log).toContain("check b");
  });

  /**
   * Signed out of PADI is the agency's state, not one diver's: every PADI card
   * after it would meet the same sign-in, so the run stops at once.
   */
  it("stops at once when the staffer is signed out of the agency", async () => {
    const { summary, log } = await run(cards("a", "b", "c"), { a: "signed_out" });
    expect(summary.stopped).toEqual({ card: { certificationId: "a" }, outcome: "signed_out" });
    expect(log).not.toContain("check b");
  });

  /**
   * Domain review R7: a captcha, a changed page or an agency this copy of the
   * extension does not check is the agency's state, not one diver's. That
   * agency's other cards are left as they are; the other agencies' go on.
   */
  it("leaves an agency's other cards after its page asks whether the staffer is human", async () => {
    const input = [
      { certificationId: "a", agency: "ssi" },
      { certificationId: "b", agency: "ssi" },
      { certificationId: "c", agency: "naui" },
      { certificationId: "d", agency: "ssi" },
      { certificationId: "e", agency: "naui" },
    ];
    const { summary, log } = await run(input, { a: "captcha", c: "unreadable" });
    expect(log.filter((line) => line.startsWith("check"))).toEqual([
      "check a",
      "check c",
      "check e",
    ]);
    expect(log.filter((line) => line.startsWith("pause"))).toHaveLength(2);
    expect(summary).toEqual({
      checked: 3,
      certified: 1,
      confirmed: 0,
      // A captcha then one unreadable page is not two unreadable in a row.
      stopped: null,
      cancelled: false,
      left: [{ card: input[0], outcome: "captcha", skipped: 2 }],
    });
  });

  it("leaves an agency's other cards after a changed page or a copy that does not check it", async () => {
    const input = [
      { certificationId: "a", agency: "gue" },
      { certificationId: "b", agency: "cmas" },
      { certificationId: "c", agency: "gue" },
      { certificationId: "d", agency: "cmas" },
    ];
    const { summary } = await run(input, { a: "page_changed", b: "unsupported" });
    expect(summary.checked).toBe(2);
    expect(summary.left).toEqual([
      { card: input[0], outcome: "page_changed", skipped: 1 },
      { card: input[1], outcome: "unsupported", skipped: 1 },
    ]);
  });

  it("checks each card once, however often the list names it", async () => {
    const { log } = await run(cards("a", "a", "b"), {});
    expect(log.filter((line) => line.startsWith("check"))).toEqual(["check a", "check b"]);
  });

  it("stops asking once the page goes away", async () => {
    const { summary, log } = await run(cards("a", "b", "c"), {}, { cancelAfter: 1 });
    expect(summary).toEqual({
      checked: 1,
      certified: 1,
      confirmed: 0,
      stopped: null,
      cancelled: true,
      left: [],
    });
    expect(log).not.toContain("check b");
  });

  it("does nothing for an empty departure", async () => {
    const { summary, log } = await run([], {});
    expect(summary).toEqual({
      checked: 0,
      certified: 0,
      confirmed: 0,
      stopped: null,
      cancelled: false,
      left: [],
    });
    expect(log).toEqual([]);
  });
});

describe("agency check outcomes", () => {
  it("stop a run at once only for a signed-out agency", () => {
    const stops = (
      [
        "certified",
        "confirmed",
        "level_unconfirmed",
        "no_record",
        "several_records",
        "unreadable",
        "signed_out",
        "transport",
        "refused",
        "captcha",
        "page_changed",
        "unsupported",
      ] as const
    ).filter(stopsAgencyCheckQueue);
    expect(stops).toEqual(["signed_out"]);
  });

  it("leave an agency's other cards only for a captcha, a changed page or an unchecked agency", () => {
    const leaves = (
      [
        "certified",
        "no_record",
        "unreadable",
        "signed_out",
        "transport",
        "refused",
        "captcha",
        "page_changed",
        "unsupported",
      ] as const
    ).filter(leavesAgencyCards);
    expect(leaves).toEqual(["captcha", "page_changed", "unsupported"]);
  });

  it("count unreadable results and transport failures toward two in a row", () => {
    const counted = (
      [
        "certified",
        "confirmed",
        "level_unconfirmed",
        "no_record",
        "several_records",
        "unreadable",
        "signed_out",
        "transport",
        "refused",
        "captcha",
        "page_changed",
        "unsupported",
      ] as const
    ).filter(isUnreadableOutcome);
    expect(counted).toEqual(["unreadable", "transport"]);
  });
});

describe("agencyCheckQueueCards", () => {
  it("keeps the given order and adds nothing", () => {
    expect(agencyCheckQueueCards(cards("c", "a", "c", "b"))).toEqual(cards("c", "a", "b"));
  });
});
