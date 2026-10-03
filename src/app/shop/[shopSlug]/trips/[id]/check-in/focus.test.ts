import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasSailed } from "@/lib/trips";
import { counterQueuePath } from "./focus";

const NOW = new Date("2026-08-27T18:00:00.000Z");

describe("hasSailed", () => {
  it("holds a boat open for the standing one-hour late-arrival buffer", () => {
    // Scheduled 55 minutes ago: trips run late and divers still arrive, so the
    // counter has not written it off yet (AGENTS.md's departure buffer).
    expect(hasSailed(new Date("2026-08-27T17:05:00.000Z"), NOW)).toBe(false);
    expect(hasSailed(new Date("2026-08-27T16:59:00.000Z"), NOW)).toBe(true);
  });
});

describe("counterQueuePath", () => {
  it("is the departure's own Check-in tab", () => {
    expect(counterQueuePath("blue-mantis", "trip-7")).toBe(
      "/shop/blue-mantis/trips/trip-7/check-in",
    );
  });

  it("escapes both halves — each reaches an action as a caller's argument", () => {
    expect(counterQueuePath("../../admin", "a b&c")).toBe(
      "/shop/..%2F..%2Fadmin/trips/a%20b%26c/check-in",
    );
  });
});

describe("the counter's redirects", () => {
  /**
   * The pin the composition rests on: **every** notice redirect on this
   * surface goes through `counterQueuePath`, so none of them can quietly build
   * a path of its own and land a refusal on some other page. Counted against
   * the actions in the file rather than a literal, so a new door is held to it
   * the day it is added.
   */
  it("build every back-path through counterQueuePath", () => {
    const source = readFileSync(path.join(import.meta.dirname, "actions.ts"), "utf8");
    const actions = [...source.matchAll(/^export async function /gm)];
    const backAssignments = [...source.matchAll(/const back = (.+);/g)].map(([, value]) => value);
    expect(backAssignments.length).toBe(actions.length);
    for (const assignment of backAssignments) {
      expect(assignment).toBe("counterQueuePath(shopSlug, tripId)");
    }
  });
});
