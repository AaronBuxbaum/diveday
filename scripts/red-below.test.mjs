import { describe, expect, it } from "vitest";

import { branchOf, redBelowMessage, unansweredRed } from "./red-below.mjs";

const red = (over = {}) => ({
  red: ["Playwright shard 2/6", "Unit tests shard 1/4"],
  pending: [],
  files: ["src/lib/clock.test.ts"],
  specs: ["e2e/booking.spec.ts"],
  unnamed: [],
  ...over,
});

describe("what of the base's red a push has not answered", () => {
  it("names the red files a branch neither edits nor replayed", () => {
    expect(unansweredRed(red(), { touched: ["src/app/page.tsx"] })).toEqual({
      files: ["src/lib/clock.test.ts", "e2e/booking.spec.ts"],
      jobs: [],
    });
  });

  it("leaves a file the branch edits (the fix in progress) and one its stamp replayed", () => {
    const stamp = { baseCi: { red: ["Unit tests shard 1/4"], ran: ["src/lib/clock.test.ts"] } };
    expect(unansweredRed(red(), { touched: ["e2e/booking.spec.ts"], stamp })).toBeNull();
  });

  it("names a red job with no file unless the stamp saw it (the author named its files)", () => {
    const verdict = red({ red: ["Build"], files: [], specs: [], unnamed: ["Build"] });
    expect(unansweredRed(verdict, { stamp: { baseCi: { red: [], ran: [] } } })).toEqual({
      files: [],
      jobs: ["Build"],
    });
    expect(unansweredRed(verdict, { stamp: { baseCi: { red: ["Build"], ran: [] } } })).toBeNull();
  });

  it("counts Lint, Typecheck and Repository safeguards as answered once there is a stamp", () => {
    const verdict = red({ red: ["Lint"], files: [], specs: [] });
    expect(unansweredRed(verdict, { stamp: { baseCi: { red: [], ran: [] } } })).toBeNull();
    expect(unansweredRed(verdict)).toEqual({ files: [], jobs: ["Lint"] });
  });

  it("is null on a green, still-running or unreadable base: the warning fails open", () => {
    expect(unansweredRed(red({ red: [], files: [], specs: [] }))).toBeNull();
    expect(unansweredRed(red({ red: [], pending: ["Playwright shard 1/6"] }))).toBeNull();
    expect(unansweredRed({ unknown: "no gh" })).toBeNull();
    expect(unansweredRed(null)).toBeNull();
  });
});

describe("the message", () => {
  it("names the layer's branch and pull request, and the two ways out, at push time", () => {
    const text = redBelowMessage({
      base: "claude/thread-1-schema",
      pull: 2932,
      red: { files: ["e2e/booking.spec.ts"], jobs: ["Build"] },
      when: "push",
    });
    expect(text).toMatch(/^THE LAYER BELOW IS RED: `claude\/thread-1-schema` \(#2932\)/);
    expect(text).toContain("e2e/booking.spec.ts, the Build job");
    expect(text).toContain("pnpm stack:sync");
    expect(text).toContain("pnpm verify:push --quick");
    expect(text).not.toMatch(/DIVEDAY_PUSH_UNVERIFIED/);
  });

  it("says main for a bottom layer, and that the gate goes red before the run", () => {
    const text = redBelowMessage({
      base: "main",
      red: { files: ["src/lib/clock.test.ts"], jobs: [] },
      when: "verify",
    });
    expect(text).toContain("`main` failed on src/lib/clock.test.ts");
    expect(text).toContain("this gate goes red unless this layer carries the fix");
  });

  it("reads a remote-tracking base as its branch", () => {
    expect(branchOf("origin/claude/x")).toBe("claude/x");
    expect(branchOf("main")).toBe("main");
    expect(branchOf(undefined)).toBe("");
  });
});
