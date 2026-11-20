import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { TripSentence } from "./trip-sentence";
import type { WaterStanding, WaterStop } from "./water-standing";
import { closeOutItems, notMadeOfferFor, wrappedSentence } from "./wrapped-close-out";

/**
 * **Wrapped up says what is left, from records** (ADR 20261117-trip-page-clock).
 * Someone not recorded back outranks every close-out; a dive is only said to
 * lack a log when its count shows it happened; a cancelled trip says so.
 */

const t = staffTranslator("en-US");
const ZONE = "America/New_York";
const at = (time: string) => new Date(`2026-11-16T${time}:00.000-05:00`);
const FALLBACK: TripSentence = {
  headline: "Scheduled back at 12:30 PM.",
  emphasis: null,
  sub: "11 guests",
};
const count = (dive: number, complete: boolean) => ({
  dive,
  complete,
  aboard: 11,
  out: 11,
  crewAboard: 2,
  by: "Keiko Tanaka",
  at: at("12:09"),
});

function standing(over: Partial<WaterStanding> = {}, dives: WaterStop[] = []): WaterStanding {
  return {
    latest: count(2, true),
    alerts: 0,
    unplaced: { noRecord: [], blocked: [] },
    notYetBack: [],
    lastAboard: ["Tom Okafor", "Lena Fischer", "Sal Reyes"],
    timeline: [
      { kind: "dock", state: "done", count: count(0, true), checks: null },
      ...dives,
      { kind: "home", state: "ahead", saidAt: null, scheduled: at("12:30") },
    ],
    ...over,
  };
}

const logged = { enteredAt: at("09:44"), exitedAt: at("10:46"), maxDepthMeters: 12.8 };
const twoDives = (secondLogged: boolean): WaterStop[] => [
  { kind: "dive", state: "done", dive: 1, site: "Molasses Reef", count: count(1, true), logged },
  {
    kind: "dive",
    state: "done",
    dive: 2,
    site: "French Reef",
    count: count(2, true),
    logged: secondLogged ? logged : null,
  },
];

function say(
  s: WaterStanding,
  cancelled = false,
  items = closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled }),
) {
  const sentence = wrappedSentence(
    s,
    items,
    FALLBACK,
    { locale: "en-US", timeZone: ZONE, cancelled, homeSaidAt: null },
    t,
  );
  return { ...sentence, headline: sentence.headline.replace(/\s/gu, " ") };
}

describe("the close-out list", () => {
  it("lists rentals out, a counted dive with no log and a draft report", () => {
    const s = standing({}, twoDives(false));
    const items = closeOutItems({
      standing: s,
      cancelled: false,
      rentalsOut: [
        { personName: "Sam Whitfield" },
        { personName: "Sam Whitfield" },
        { personName: "Diego Alvarez" },
      ],
      reports: [
        { id: "r-1", status: "draft", createdByName: "Keiko Tanaka" },
        { id: "r-2", status: "filed", createdByName: "Sal Reyes" },
      ],
    });
    expect(items).toEqual([
      { kind: "rentals", count: 3, names: ["Sam Whitfield", "Diego Alvarez"] },
      { kind: "noLog", dive: 2, site: "French Reef" },
      { kind: "draftReport", id: "r-1", by: "Keiko Tanaka" },
    ]);
    expect(say(s, false, items)).toMatchObject({
      headline: "Everyone is recorded back. 3 things to close out.",
      emphasis: "3 things",
    });
  });

  it("never reads clean while a dive's count is not finished: it names who boarded", () => {
    // Dive 2 was never counted. Nothing shows it happened, so it does not lack
    // a log; but the people who boarded at the dock are not recorded back
    // after it, and that is the first thing left.
    const s = standing({ latest: count(1, true) }, [
      { kind: "dive", state: "done", dive: 1, site: null, count: count(1, true), logged },
      { kind: "dive", state: "ahead", dive: 2, site: null, count: null, logged: null },
    ]);
    const items = closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled: false });
    expect(items).toEqual([
      { kind: "rollCall", names: ["Tom Okafor", "Lena Fischer", "Sal Reyes"], dive: 2 },
    ]);
    expect(items.some((item) => item.kind === "noLog")).toBe(false);
    // Dive 1's count does not say everyone is back.
    expect(say(s).headline).toBe("Scheduled back at 12:30 PM. 1 thing to close out.");
  });

  it("names a later dive nobody counted, though the dock count was skipped", () => {
    // No dock count; dive 1 counted complete; dive 2 never counted. The people
    // dive 1 recorded aboard are not recorded back after dive 2.
    const s = standing({ latest: count(1, true), lastAboard: ["Tom Okafor"] }, [
      { kind: "dive", state: "done", dive: 1, site: null, count: count(1, true), logged },
      { kind: "dive", state: "ahead", dive: 2, site: null, count: null, logged: null },
    ]);
    s.timeline[0] = { kind: "dock", state: "done", count: null, checks: null };
    expect(closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled: false })).toEqual([
      { kind: "rollCall", names: ["Tom Okafor"], dive: 2 },
    ]);
    expect(say(s).headline).toBe("Scheduled back at 12:30 PM. 1 thing to close out.");
  });

  it("never reads clean when people were counted aboard at the dock on a trip with no planned dives", () => {
    // A snorkel or pool day: the timeline is the dock and Home. Five aboard at
    // the dock and nobody recorded back; the dock count is where each is put ashore.
    const five = ["Tom Okafor", "Lena Fischer", "Sal Reyes", "Ana Ruiz", "Joe Park"];
    const s = standing({ latest: { ...count(0, true), aboard: 5 }, lastAboard: five });
    const items = closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled: false });
    expect(items).toEqual([{ kind: "rollCall", names: five, dive: 0 }]);
    expect(say(s).headline).toBe("Scheduled back at 12:30 PM. 1 thing to close out.");
  });

  it("names a dock count that was started and not finished", () => {
    const s = standing({ latest: count(0, false) }, [
      { kind: "dive", state: "ahead", dive: 1, site: null, count: null, logged: null },
    ]);
    s.timeline[0] = { kind: "dock", state: "now", count: count(0, false), checks: null };
    expect(closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled: false })).toEqual([
      { kind: "rollCall", names: ["Tom Okafor", "Lena Fischer", "Sal Reyes"], dive: 0 },
    ]);
  });

  it("sends a trip scrubbed at the dock back to the dock count, never to a dive", () => {
    // Cancelled while still tied up: whoever the dock count put aboard is put
    // ashore at the dock; an after-dive count would record a dive that never was.
    const s = standing({ latest: count(0, true) }, [
      { kind: "dive", state: "ahead", dive: 1, site: null, count: null, logged: null },
    ]);
    expect(closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled: true })).toEqual([
      { kind: "rollCall", names: ["Tom Okafor", "Lena Fischer", "Sal Reyes"], dive: 0 },
    ]);
    // Nobody aboard at the dock: nothing to put ashore.
    expect(
      closeOutItems({
        standing: { ...s, lastAboard: [] },
        rentalsOut: [],
        reports: [],
        cancelled: true,
      }),
    ).toEqual([]);
  });

  it("still lists what it can when the roll call cannot be read", () => {
    expect(
      closeOutItems({
        standing: null,
        rentalsOut: [{ personName: "Sam Whitfield" }],
        reports: [],
        cancelled: false,
        flySafe: [{ name: "Tom Okafor" }],
      }),
    ).toEqual([
      { kind: "flySafe", names: ["Tom Okafor"] },
      { kind: "rentals", count: 1, names: ["Sam Whitfield"] },
    ]);
  });

  it("names a dive count that was started and not finished", () => {
    const s = standing({ latest: count(2, false) }, [
      { kind: "dive", state: "done", dive: 1, site: null, count: count(1, true), logged },
      { kind: "dive", state: "now", dive: 2, site: null, count: count(2, false), logged },
    ]);
    expect(closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled: false })).toEqual([
      { kind: "rollCall", names: ["Tom Okafor", "Lena Fischer", "Sal Reyes"], dive: 2 },
    ]);
  });

  it("says no roll call was taken, never an all-clear", () => {
    const s = standing({ latest: null, lastAboard: [] }, [
      { kind: "dive", state: "ahead", dive: 1, site: null, count: null, logged: null },
    ]);
    s.timeline[0] = { kind: "dock", state: "ahead", count: null, checks: null };
    const items = closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled: false });
    expect(items).toEqual([{ kind: "noRollCall" }]);
    expect(say(s).headline).toBe("Scheduled back at 12:30 PM. 1 thing to close out.");
    // A cancelled trip nobody boarded has no roll call to take.
    expect(closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled: true })).toEqual(
      [],
    );
  });

  it("puts a roll call with people not recorded back first, and says them in the sentence", () => {
    const s = standing(
      {
        latest: count(2, false),
        notYetBack: [
          {
            key: "p:tom",
            name: "Tom Okafor",
            crew: false,
            status: "notBack",
            afterDive: 2,
            buddies: [],
            note: null,
          },
        ],
      },
      twoDives(true),
    );
    const items = closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled: false });
    expect(items[0]).toEqual({ kind: "rollCall", names: ["Tom Okafor"], dive: 2 });
    expect(say(s, false, items).headline).toBe(
      "1 person is recorded not back aboard after dive 2.",
    );
  });

  it("lists this trip's flying guidance to follow up, by guest, after the roll call", () => {
    const s = standing({}, twoDives(true));
    const items = closeOutItems({
      standing: s,
      rentalsOut: [],
      reports: [],
      cancelled: false,
      flySafe: [{ name: "Tom Okafor" }, { name: "Lena Fischer" }],
    });
    expect(items).toEqual([{ kind: "flySafe", names: ["Tom Okafor", "Lena Fischer"] }]);
  });

  it("says all is closed when nothing is left", () => {
    expect(say(standing({}, twoDives(true))).headline).toBe(
      "Everyone is recorded back. Nothing left to close out.",
    );
  });

  it("says a cancelled trip is cancelled", () => {
    const cancelled = { headline: "This trip is canceled.", emphasis: null, sub: null };
    const s = standing({ latest: null }, []);
    expect(
      wrappedSentence(
        s,
        [],
        cancelled,
        { locale: "en-US", timeZone: ZONE, cancelled: true, homeSaidAt: null },
        t,
      ).headline,
    ).toBe("This trip is canceled.");
  });
});

/**
 * **A planned dive the crew recorded not made** (issue #4681, the safety
 * contract Aaron accepted 2026-11-19). It closes that dive's roll-call item and
 * nothing else: it is never a finished count, never says everyone is back, and
 * never hides somebody not recorded back or an open missing-diver alert.
 */
describe("a dive recorded not made", () => {
  const sal = { by: "Sal Reyes", at: at("11:40") };
  const dive1 = (): WaterStop => ({
    kind: "dive",
    state: "done",
    dive: 1,
    site: null,
    count: count(1, true),
    logged,
  });
  const unmade = (dive: number): WaterStop => ({
    kind: "dive",
    state: "ahead",
    dive,
    site: null,
    count: null,
    logged: null,
    notMade: sal,
  });
  const open = (dive: number): WaterStop => ({
    kind: "dive",
    state: "ahead",
    dive,
    site: null,
    count: null,
    logged: null,
  });
  const items = (s: WaterStanding, cancelled = false) =>
    closeOutItems({ standing: s, rentalsOut: [], reports: [], cancelled });

  it("closes that dive's roll-call item, and is never read as everyone back", () => {
    const s = standing({ latest: count(1, true) }, [dive1(), unmade(2)]);
    expect(items(s)).toEqual([]);
    // Dive 1's count stays dive 1's: the sentence never claims a finished last count.
    expect(say(s).headline).toBe("Scheduled back at 12:30 PM. Nothing left to close out.");
    expect(notMadeOfferFor(s, items(s))).toBeNull();
  });

  it("closes only its own dive: a later dive nobody counted is still named", () => {
    const s = standing({ latest: count(1, true) }, [dive1(), unmade(2), open(3)]);
    expect(items(s)).toEqual([
      { kind: "rollCall", names: ["Tom Okafor", "Lena Fischer", "Sal Reyes"], dive: 3 },
    ]);
  });

  it("never hides a person not recorded back", () => {
    const s = standing(
      {
        latest: count(1, false),
        notYetBack: [
          {
            key: "p:tom",
            name: "Tom Okafor",
            crew: false,
            status: "notBack",
            afterDive: 1,
            buddies: [],
            note: null,
          },
        ],
      },
      [dive1(), unmade(2)],
    );
    expect(items(s)).toEqual([{ kind: "rollCall", names: ["Tom Okafor"], dive: 1 }]);
    expect(say(s).headline).toBe("1 person is recorded not back aboard after dive 1.");
  });

  it("never quiets an open missing-diver alert", () => {
    const s = standing({ latest: count(1, true), alerts: 1 }, [dive1(), unmade(2)]);
    expect(say(s).headline).not.toContain("Nothing left");
  });

  it("leaves the dock count to put people ashore when no dive was made at all", () => {
    const s = standing({ latest: count(0, true) }, [unmade(1), unmade(2)]);
    expect(items(s)).toEqual([
      { kind: "rollCall", names: ["Tom Okafor", "Lena Fischer", "Sal Reyes"], dive: 0 },
    ]);
  });

  it("is offered only for an open dive with no count begun, when nobody is outstanding", () => {
    const s = standing({ latest: count(1, true) }, [dive1(), open(2)]);
    expect(notMadeOfferFor(s, items(s))).toBe(2);
    // A count begun on the dive says it was made.
    const begun = standing({ latest: count(2, false) }, [
      dive1(),
      { kind: "dive", state: "now", dive: 2, site: null, count: count(2, false), logged: null },
    ]);
    expect(notMadeOfferFor(begun, items(begun))).toBeNull();
    // Somebody not recorded back comes first, and is never closed this way.
    const outstanding = standing(
      {
        latest: count(1, true),
        notYetBack: [
          {
            key: "p:tom",
            name: "Tom Okafor",
            crew: false,
            status: "unrecorded",
            afterDive: null,
            buddies: [],
            note: null,
          },
        ],
      },
      [dive1(), open(2)],
    );
    expect(notMadeOfferFor(outstanding, items(outstanding))).toBeNull();
    const alerted = standing({ latest: count(1, true), alerts: 1 }, [dive1(), open(2)]);
    expect(notMadeOfferFor(alerted, items(alerted))).toBeNull();
    // The dock count is never a dive.
    const dock = standing({ latest: count(0, false) }, [open(1)]);
    expect(notMadeOfferFor(dock, items(dock))).toBeNull();
  });

  it("is not offered for a dive somebody logged, though nobody counted it", () => {
    const at = new Date("2026-11-16T11:00:00.000-05:00");
    const logged = standing({ latest: count(1, true) }, [
      dive1(),
      {
        kind: "dive",
        state: "ahead",
        dive: 2,
        site: null,
        count: null,
        logged: { enteredAt: at, exitedAt: null, maxDepthMeters: null },
      },
    ]);
    expect(notMadeOfferFor(logged, items(logged))).toBeNull();
  });
});
