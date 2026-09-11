import { describe, expect, it } from "vitest";
import {
  boardPath,
  boardTitleFor,
  CHECK_IN_LINK_TTL_DAYS,
  checkInLinkExpiresAt,
  DISPLAY_LABEL_MAX_LENGTH,
  normalizeDisplayLabel,
} from "./display-tokens";

describe("boardPath", () => {
  it("puts the token in the path segment", () => {
    expect(boardPath("abc123_-")).toBe("/board/abc123_-");
  });

  it("encodes a value that would otherwise detach the segment", () => {
    expect(boardPath("a/b?c#d")).toBe("/board/a%2Fb%3Fc%23d");
  });
});

describe("normalizeDisplayLabel", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeDisplayLabel("  Lobby   TV \n")).toBe("Lobby TV");
  });

  it("refuses an empty or whitespace-only label", () => {
    expect(normalizeDisplayLabel("")).toBeNull();
    expect(normalizeDisplayLabel("   ")).toBeNull();
    expect(normalizeDisplayLabel(undefined)).toBeNull();
    expect(normalizeDisplayLabel(42)).toBeNull();
  });

  it("refuses rather than truncates a label past the cap", () => {
    expect(normalizeDisplayLabel("x".repeat(DISPLAY_LABEL_MAX_LENGTH))).toHaveLength(
      DISPLAY_LABEL_MAX_LENGTH,
    );
    expect(normalizeDisplayLabel("x".repeat(DISPLAY_LABEL_MAX_LENGTH + 1))).toBeNull();
  });
});

describe("boardTitleFor", () => {
  it("names an ordinary departure by its title", () => {
    expect(boardTitleFor({ title: "Two-Tank Reef", isPrivate: false })).toEqual({
      kind: "title",
      title: "Two-Tank Reef",
    });
  });

  it("never names a private charter", () => {
    const title = boardTitleFor({ title: "The Hendersons' charter", isPrivate: true });
    expect(title).toEqual({ kind: "private" });
    expect(JSON.stringify(title)).not.toContain("Henderson");
  });
});

/**
 * **A check-in link's lifetime is measured from the instant it is minted or
 * renewed** (issue #1609), so a renewal is a full reset rather than a top-up
 * onto whatever was left.
 */
describe("checkInLinkExpiresAt", () => {
  it("is the full lifetime past the instant it is given", () => {
    const now = new Date("2026-04-01T09:30:00.000Z");
    const expires = checkInLinkExpiresAt(now);
    expect(expires.getTime() - now.getTime()).toBe(CHECK_IN_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
    // A season plus a shoulder: the April tablet is asked about before April.
    expect(expires.getTime()).toBeLessThan(new Date("2027-04-01T09:30:00.000Z").getTime());
  });

  it("does not read the wall clock, so a renewal is reproducible", () => {
    const now = new Date("2026-04-01T09:30:00.000Z");
    expect(checkInLinkExpiresAt(now)).toEqual(checkInLinkExpiresAt(new Date(now)));
  });
});
