import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The departure page is a Server Component over a dozen reads, so these read
 * its source rather than render it. They pin the page's composition, not the
 * behaviour of what it composes; that lives beside each component.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the departure's tabs", () => {
  /**
   * ADR 20261001-logbook, decision 3, as amended 2026-10-05: the departure is
   * four tabs under a stage stepper. This page is two of them, Divers and Details, chosen by `?view=`
   * or by an About form's own notice, so a save on Details lands back on it.
   */
  it("draws the tabs right under the masthead, on every departure", () => {
    const body = SOURCE.slice(SOURCE.indexOf("export default async function"));
    const masthead = body.indexOf("<TripPageHeader");
    const tabs = body.indexOf("<TripTabs");
    expect(tabs).toBeGreaterThan(masthead);
    // Never behind `cancelled`: the Boat tab is a blown-out departure's way to
    // its roll call (dive-domain review 20260920).
    const opener = body.slice(body.lastIndexOf("\n", tabs - 1), tabs);
    expect(opener.trim()).toBe("");
    expect(body.slice(body.lastIndexOf("*/}", tabs), tabs)).not.toMatch(/\?|&&/);
  });
});
