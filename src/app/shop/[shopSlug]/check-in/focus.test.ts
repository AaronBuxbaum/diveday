import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { counterQueuePath, hasDeparted, selectFocusedDeparture } from "./focus";

const NOW = new Date("2026-08-27T18:00:00.000Z");
const at = (iso: string, today = true) => ({ tripId: iso, startsAt: new Date(iso), today });

describe("hasDeparted", () => {
  it("holds a boat open for the standing one-hour late-arrival buffer", () => {
    // Scheduled 55 minutes ago: trips run late and divers still arrive, so the
    // counter has not written it off yet (AGENTS.md's departure buffer).
    expect(hasDeparted(new Date("2026-08-27T17:05:00.000Z"), NOW)).toBe(false);
    expect(hasDeparted(new Date("2026-08-27T16:59:00.000Z"), NOW)).toBe(true);
  });
});

describe("counterQueuePath", () => {
  it("carries the focused departure so a refusal lands back on it", () => {
    expect(counterQueuePath("blue-mantis", "trip-7")).toBe(
      "/shop/blue-mantis/check-in?trip=trip-7",
    );
  });

  it("is the bare queue when nothing is focused", () => {
    expect(counterQueuePath("blue-mantis", null)).toBe("/shop/blue-mantis/check-in");
  });

  it("escapes both halves — the slug reaches an action as a caller's argument", () => {
    expect(counterQueuePath("../../admin", "a b&c")).toBe(
      "/shop/..%2F..%2Fadmin/check-in?trip=a%20b%26c",
    );
  });
});

describe("selectFocusedDeparture", () => {
  it("focuses the next un-departed boat by default", () => {
    const focus = selectFocusedDeparture(
      [at("2026-08-27T11:00:00.000Z"), at("2026-08-27T19:00:00.000Z")],
      undefined,
      NOW,
    );
    expect(focus?.tripId).toBe("2026-08-27T19:00:00.000Z");
  });

  it("honours the departure the URL names", () => {
    const focus = selectFocusedDeparture(
      [at("2026-08-27T11:00:00.000Z"), at("2026-08-27T19:00:00.000Z")],
      "2026-08-27T11:00:00.000Z",
      NOW,
    );
    expect(focus?.tripId).toBe("2026-08-27T11:00:00.000Z");
  });

  it("falls through a stale id rather than emptying the instrument", () => {
    const focus = selectFocusedDeparture([at("2026-08-27T19:00:00.000Z")], "deleted-trip", NOW);
    expect(focus?.tripId).toBe("2026-08-27T19:00:00.000Z");
  });

  it("focuses the most recent departed boat once the day's boats have all sailed", () => {
    // The evening rule, and the safety-shaped one: the arrivals window reaches
    // backwards because a late walk-in inside the one-hour buffer is real, so
    // the counter must not skip ahead to tomorrow and leave them nothing.
    const focus = selectFocusedDeparture(
      [
        at("2026-08-27T11:00:00.000Z"),
        at("2026-08-27T14:00:00.000Z"),
        at("2026-08-28T11:00:00.000Z", false),
      ],
      undefined,
      NOW,
    );
    expect(focus?.tripId).toBe("2026-08-27T14:00:00.000Z");
  });

  it("points at tomorrow's first boat on a day with no departures of its own", () => {
    const focus = selectFocusedDeparture([at("2026-08-28T11:00:00.000Z", false)], undefined, NOW);
    expect(focus?.tripId).toBe("2026-08-28T11:00:00.000Z");
  });

  it("focuses nothing when there is nothing to focus", () => {
    expect(selectFocusedDeparture([], undefined, NOW)).toBeNull();
  });
});

describe("the counter's redirects", () => {
  /**
   * The pin the composition rests on: **every** notice redirect on this
   * surface goes through `counterQueuePath`, so none of them can quietly go
   * back to building `shopPath(shopSlug, "check-in")` and dropping the focus.
   * A structural assertion rather than three redirect round-trips, because
   * what fails here is an omission, not a behaviour.
   */
  it("build every back-path through counterQueuePath", () => {
    const source = readFileSync(path.join(import.meta.dirname, "actions.ts"), "utf8");
    const backAssignments = [...source.matchAll(/const back = (.+);/g)].map(([, value]) => value);
    expect(backAssignments.length).toBe(3);
    for (const assignment of backAssignments) {
      expect(assignment).toBe("counterQueuePath(shopSlug, focusTripId)");
    }
  });
});
