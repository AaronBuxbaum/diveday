import { describe, expect, it } from "vitest";
import type { DiverChecklistItem } from "./readiness-summary";
import { buildThreadSteps, isDiveDay, partyIsAllSet, type ThreadStepsInput } from "./thread-steps";

/**
 * The rules ADR 20260827-the-divers-thread's decision 3 states, pinned — not
 * the layout the spine renders in, which is `ThreadSpine.test.tsx`'s job and
 * the artboard's argument.
 *
 * The load-bearing one is the last: **the figure can always fill.** The page
 * this replaced counted seven rows and let three of them ("Optional") stay
 * unanswerable forever, so a diver who had done everything asked of them read
 * "4 of 7 done" under a bar that could not reach the end.
 */

function item(overrides: Partial<DiverChecklistItem> & Pick<DiverChecklistItem, "category">) {
  return {
    state: "done",
    detailCode: "waiver_done",
    actionable: [],
    ...overrides,
  } as DiverChecklistItem;
}

function spine(overrides: Partial<ThreadStepsInput> = {}) {
  return buildThreadSteps({
    checklist: [item({ category: "waiver" })],
    hasPayableOrder: false,
    rentalFitComplete: false,
    dayOfComplete: false,
    ...overrides,
  });
}

describe("buildThreadSteps", () => {
  it("walks sign, certification, pay, gear, day-of, in that order", () => {
    const built = spine({
      checklist: [
        item({ category: "waiver" }),
        item({ category: "certification", state: "waiting", detailCode: "certification_pending" }),
        item({ category: "payment", state: "action", detailCode: "payment_due" }),
      ],
    });
    expect(built.steps.map((step) => step.id)).toEqual([
      "sign",
      "certification",
      "pay",
      "gear",
      "dayof",
    ]);
    expect(built.steps.map((step) => step.state)).toEqual([
      "done",
      "with_shop",
      "your_turn",
      "your_turn",
      "your_turn",
    ]);
  });

  it("counts every step it emits, so the figure can always reach its total", () => {
    const built = spine({
      checklist: [
        item({ category: "waiver" }),
        item({ category: "certification" }),
        item({ category: "payment" }),
      ],
      hasPayableOrder: true,
      rentalFitComplete: true,
      dayOfComplete: true,
    });
    expect(built.countable).toBe(5);
    expect(built.done).toBe(5);
    expect(built.current).toBeNull();
  });

  it("settles Day-of details on the recency answer alone", () => {
    // The note, the hotel pickup and the support-needs record live inside this
    // step and answer to nobody: they were three permanently-"Optional" rows,
    // which is exactly what made the old figure unfillable.
    expect(spine({ dayOfComplete: false }).steps.at(-1)).toMatchObject({
      id: "dayof",
      state: "your_turn",
    });
    expect(spine({ dayOfComplete: true }).steps.at(-1)).toMatchObject({
      id: "dayof",
      state: "done",
    });
  });

  it("still reaches its total on an unpriced booking that gates on nothing", () => {
    const built = spine({
      checklist: [item({ category: "waiver" })],
      hasPayableOrder: false,
      rentalFitComplete: true,
      dayOfComplete: true,
    });
    expect(built.steps.map((step) => step.id)).toEqual(["sign", "gear", "dayof"]);
    expect(built.done).toBe(built.countable);
    expect(built.countable).toBe(3);
  });

  it("renders no Pay step when nothing was ever owed", () => {
    expect(spine().steps.some((step) => step.id === "pay")).toBe(false);
  });

  it("renders a settled Pay step for money taken on a departure that gates on none", () => {
    // `payAtBooking` took a card while `trip_requirements.requires_payment` is
    // false, so the readiness engine raises no payment category at all. The
    // money still has to render somewhere.
    const built = spine({ hasPayableOrder: true });
    expect(built.steps.find((step) => step.id === "pay")).toMatchObject({ state: "done" });
  });

  it("renders no Sign step for a departure that asks for no waiver", () => {
    // `requires_waiver` defaults true, so this is the rare shop-side switch —
    // and a phantom step would be either a lie when marked done or a hole in
    // the figure when not. The thread is honestly two steps long.
    const built = spine({ checklist: [], rentalFitComplete: true, dayOfComplete: true });
    expect(built.steps.map((step) => step.id)).toEqual(["gear", "dayof"]);
    expect(built.done).toBe(built.countable);
  });

  it("opens the first step that is the diver's, and only that one", () => {
    const built = spine({
      checklist: [item({ category: "waiver", state: "action", detailCode: "waiver_pending" })],
    });
    // Sign, gear and day-of are all the diver's here; `current` names one.
    expect(built.steps.filter((step) => step.state === "your_turn")).toHaveLength(3);
    expect(built.current).toBe("sign");
  });

  it("names no current step when everything left sits with the shop", () => {
    const built = spine({
      checklist: [
        item({ category: "waiver", state: "waiting", detailCode: "medical_review" }),
        item({ category: "certification", state: "waiting", detailCode: "certification_pending" }),
      ],
      rentalFitComplete: true,
      dayOfComplete: true,
    });
    expect(built.current).toBeNull();
    expect(built.done).toBeLessThan(built.countable);
  });

  it("collapses to the setup item with no spine and no figure", () => {
    const setup = item({
      category: "setup",
      state: "waiting",
      detailCode: "under_minimum_age",
    });
    const built = spine({ checklist: [setup] });
    expect(built.steps).toEqual([]);
    expect(built.countable).toBe(0);
    expect(built.current).toBeNull();
    // The engine's own sentence, not the generic one: H-22's minimum-age
    // wording says something a diver can act on.
    expect(built.setupItem).toBe(setup);
  });
});

describe("isDiveDay", () => {
  const timeZone = "America/New_York";
  // 11:00–14:30 on Saturday 29 August, New York time.
  const startsAt = new Date("2026-08-29T15:00:00Z");
  const endsAt = new Date("2026-08-29T18:30:00Z");

  it("is true from midnight in the shop's own zone", () => {
    expect(isDiveDay({ startsAt, endsAt, timeZone, now: new Date("2026-08-29T04:05:00Z") })).toBe(
      true,
    );
  });

  it("is false the night before, however few hours are left", () => {
    // 23:30 on the 28th in New York — three and a half hours out, and still
    // not the day. The rule is a calendar date, not a duration.
    expect(isDiveDay({ startsAt, endsAt, timeZone, now: new Date("2026-08-29T03:30:00Z") })).toBe(
      false,
    );
  });

  it("holds through the standing late-arrival buffer, and stops after it", () => {
    expect(isDiveDay({ startsAt, endsAt, timeZone, now: new Date("2026-08-29T19:20:00Z") })).toBe(
      true,
    );
    expect(isDiveDay({ startsAt, endsAt, timeZone, now: new Date("2026-08-29T19:40:00Z") })).toBe(
      false,
    );
  });

  it("reads the date in the shop's zone, not the server's", () => {
    // 21:00 on the 28th in Honolulu is already the 29th in UTC. A UTC server
    // deciding this would tell a Hawaiian diver their boat is today, a day
    // early — the exact class of bug AGENTS.md's timezone rule exists for.
    expect(
      isDiveDay({
        startsAt: new Date("2026-08-29T21:00:00Z"),
        endsAt: new Date("2026-08-30T00:00:00Z"),
        timeZone: "Pacific/Honolulu",
        now: new Date("2026-08-29T07:00:00Z"),
      }),
    ).toBe(false);
  });
});

describe("partyIsAllSet", () => {
  const settled = { claimed: true, waiverSigned: true };

  it("never renders for a party of one", () => {
    expect(partyIsAllSet({ seats: [], ownSignSettled: true, diveDay: false })).toBe(false);
  });

  it("renders once every seat is claimed and signed, and the reader is too", () => {
    expect(partyIsAllSet({ seats: [settled, settled], ownSignSettled: true, diveDay: false })).toBe(
      true,
    );
  });

  it("never renders while a claim or a waiver is outstanding", () => {
    expect(
      partyIsAllSet({
        seats: [settled, { claimed: false, waiverSigned: false }],
        ownSignSettled: true,
        diveDay: false,
      }),
    ).toBe(false);
    expect(
      partyIsAllSet({
        seats: [settled, { claimed: true, waiverSigned: false }],
        ownSignSettled: true,
        diveDay: false,
      }),
    ).toBe(false);
  });

  it("never renders while the reader's own waiver is unsigned", () => {
    expect(partyIsAllSet({ seats: [settled], ownSignSettled: false, diveDay: false })).toBe(false);
  });

  it("yields to the dive-day block on the day itself", () => {
    expect(partyIsAllSet({ seats: [settled], ownSignSettled: true, diveDay: true })).toBe(false);
  });
});
