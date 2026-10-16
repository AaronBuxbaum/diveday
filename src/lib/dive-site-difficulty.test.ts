import { describe, expect, it } from "vitest";
import {
  parseDiveSiteDifficulty,
  parseSnorkelSuitable,
  snorkelersOnUnsuitableSites,
} from "./dive-site-difficulty";

/**
 * `dive_sites.difficulty` was free text until 2026-08-13, and immutable
 * published template versions still carry whatever was written there. So the
 * parser is not only a form guard — it is the reader for two generations of
 * stored data, and the property that matters is that it never invents a
 * reading it was not given.
 */
describe("parseDiveSiteDifficulty", () => {
  it("takes the three codes", () => {
    expect(parseDiveSiteDifficulty("beginner")).toBe("beginner");
    expect(parseDiveSiteDifficulty("intermediate")).toBe("intermediate");
    expect(parseDiveSiteDifficulty("advanced")).toBe("advanced");
  });

  it("reads the legacy free text every shop and template actually stored", () => {
    // The column held whatever a staffer typed, and the migration's backfill
    // matches on exactly this shape. If these stopped parsing, a published
    // template would silently import with no difficulty at all.
    expect(parseDiveSiteDifficulty("Advanced")).toBe("advanced");
    expect(parseDiveSiteDifficulty("  Beginner  ")).toBe("beginner");
  });

  it("reads anything else as nothing said, never as a guess", () => {
    // The briefing renders "crew-led" for null, which is the honest answer for
    // a word the app cannot translate. Mapping "calm" onto beginner would be
    // the app deciding what a shop meant.
    for (const value of ["calm", "expert", "all levels", "", "   ", null, undefined, 3, {}]) {
      expect(parseDiveSiteDifficulty(value)).toBeNull();
    }
  });
});

/**
 * Issue #2214 (Aaron 2026-10-13): a warning, never a refusal, and only when
 * every planned site is marked unsuitable. The quiet cases are the ones that
 * matter: a warning that fires on unrated sites trains staff to ignore it.
 */
describe("snorkelersOnUnsuitableSites", () => {
  const no = { snorkelSuitable: false };
  const yes = { snorkelSuitable: true };
  const unsaid = { snorkelSuitable: null };

  it("warns when snorkeler seats are open and every planned site says no", () => {
    expect(snorkelersOnUnsuitableSites({ snorkelerSeatsOpen: true, plannedSites: [no] })).toBe(
      true,
    );
    expect(snorkelersOnUnsuitableSites({ snorkelerSeatsOpen: true, plannedSites: [no, no] })).toBe(
      true,
    );
  });

  it("stays quiet when snorkeler seats are not open", () => {
    expect(snorkelersOnUnsuitableSites({ snorkelerSeatsOpen: false, plannedSites: [no] })).toBe(
      false,
    );
  });

  it("stays quiet when one planned site is suitable", () => {
    expect(snorkelersOnUnsuitableSites({ snorkelerSeatsOpen: true, plannedSites: [no, yes] })).toBe(
      false,
    );
  });

  it("never reads a site the shop has not rated as no", () => {
    expect(
      snorkelersOnUnsuitableSites({ snorkelerSeatsOpen: true, plannedSites: [no, unsaid] }),
    ).toBe(false);
    expect(snorkelersOnUnsuitableSites({ snorkelerSeatsOpen: true, plannedSites: [unsaid] })).toBe(
      false,
    );
  });

  it("stays quiet with no site planned", () => {
    expect(snorkelersOnUnsuitableSites({ snorkelerSeatsOpen: true, plannedSites: [] })).toBe(false);
  });
});

describe("parseSnorkelSuitable", () => {
  it("takes yes and no, and reads anything else as not said", () => {
    expect(parseSnorkelSuitable("yes")).toBe(true);
    expect(parseSnorkelSuitable("no")).toBe(false);
    expect(parseSnorkelSuitable("")).toBeNull();
    expect(parseSnorkelSuitable("true")).toBeNull();
    expect(parseSnorkelSuitable(undefined)).toBeNull();
  });
});
