import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_DESTINATIONS } from "@/lib/staff-destinations";

/**
 * **Settings is the door to everything in its nav section.**
 *
 * The sidebar has one row for Settings (ADR 20261001-logbook), so a
 * destination filed under the `settings` section — the site library, the
 * waiver template, the team, a staffer's calendar feed — is reached through a
 * row on this page or not at all, other than the search. The gear register
 * once had no door anywhere a staffer looked (#1937); this test is why that
 * cannot happen to a settings destination.
 *
 * **It reads the source rather than rendering**, because the failure is a
 * missing element. The doors are `SettingsDoorRow` hrefs built from one
 * template — `/shop/${shopSlug}/<suffix>` — so the suffix is greppable.
 *
 * The rule runs **both ways**: a destination with a section of its own in the
 * nav does not also get a door here, or Settings grows back into a second nav.
 */
const SETTINGS_PAGE = path.join(import.meta.dirname, "SettingsPage.tsx");

/** `/shop/${shopSlug}/promos` and `/shop/${shopSlug}/settings/team` alike. */
const DOOR_HREF = /shopSlug\}(\/[a-z-]+(?:\/[a-z-]+)?)`/g;

describe("Settings is the door to everything in its section", () => {
  it("has a row for each `settings` destination, and for no other", async () => {
    const source = await readFile(SETTINGS_PAGE, "utf8");
    const doors = new Set(Array.from(source.matchAll(DOOR_HREF), (match) => match[1] as string));

    for (const destination of STAFF_DESTINATIONS) {
      // Settings is the page, not a row on itself.
      if (destination.id === "settings") continue;
      expect(doors.has(destination.suffix), `${destination.id} (${destination.suffix})`).toBe(
        destination.section === "settings",
      );
    }

    // **And no door pointing at something that is not a destination at all.**
    // The loop above only ever looks *up* suffixes the registry already knows,
    // so a row pointing somewhere it has never heard of is invisible to it —
    // which is the hole `sourcery-ai` found on #1939.
    //
    // Settings' own sub-pages are the deliberate exception, and the reason the
    // fix is not a plain set equality: `/settings/boats`, `/settings/trip-tags`,
    // `/settings/security` and a dozen more are surfaces *under* this page
    // rather than destinations, so the registry does not know them and should
    // not. Anything else — a door to a top-level `/shop/<slug>/<something>`
    // with no row in `STAFF_DESTINATIONS` — is a destination declared outside
    // the one file a destination may be declared in.
    const shopSuffixes = new Set(
      STAFF_DESTINATIONS.filter((destination) => destination.section === "settings").map(
        (destination) => destination.suffix,
      ),
    );
    const strays = [...doors].filter(
      (door) => !door.startsWith("/settings/") && !shopSuffixes.has(door),
    );
    expect(strays).toEqual([]);
  });

  it("reads the doors it is asserting over, rather than an empty set", async () => {
    // The paired positive: every assertion above is an equality against a
    // `Set`, so a regex that stopped matching would agree with a registry in
    // which nothing is `shop` and quietly pass on half the rows it was
    // written for.
    const source = await readFile(SETTINGS_PAGE, "utf8");
    const doors = Array.from(source.matchAll(DOOR_HREF), (match) => match[1]);
    expect(doors).toContain("/dive-sites");
    expect(doors.length).toBeGreaterThan(5);
  });
});
