import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_DESTINATIONS } from "@/lib/staff-destinations";

/**
 * **`place: "shop"` means "behind the shop's own name", so Settings has to
 * have the door.**
 *
 * Slice 23b regrouped the staff destinations by *when* each thing happens —
 * `day`, `week`, `season`, and `shop` for the one place with no hour in it
 * (ADR 20260919-one-idea, decision I · Tide: "Only Settings has no hour and
 * lives behind the shop's name"). The bar wears three times and never a list,
 * and `ShopIdentityMenu` holds exactly one link — Settings — so a `shop`
 * destination's whole path, other than the search, is a row on this page.
 *
 * Nothing held the two halves together, and they came apart the same day: the
 * gear register carried `navGroup: "daily"` before the regroup, was mapped to
 * `place: "shop"`, and has never had a door here. On any morning with nothing
 * overdue it was reachable by the search alone — which is what ADR
 * 20260813-more-is-the-shops-other-door retired an earlier nav for. It is
 * `day` now (#1937), and this test is why the pair cannot drift again.
 *
 * **It reads the source rather than rendering**, because the failure is a
 * missing element: a render test asserts what it is given and a door that was
 * never written is invisible to it. The doors are `SettingsDoorRow` hrefs
 * built from one template — `/shop/${shopSlug}/<suffix>` — so the suffix is
 * greppable, and a door written any other way is a change this test should
 * make somebody justify.
 *
 * The rule runs **both ways**. A `shop` destination with no door is the gear
 * bug; a `day`, `week` or `season` destination that acquires one is the same
 * mistake from the other side — Settings growing back into the nav of nouns
 * that slice 23b deleted.
 */
const SETTINGS_PAGE = path.join(import.meta.dirname, "SettingsPage.tsx");

/** `/shop/${shopSlug}/promos` and `/shop/${shopSlug}/settings/team` alike. */
const DOOR_HREF = /shopSlug\}(\/[a-z-]+(?:\/[a-z-]+)?)`/g;

describe("Settings is the door to every place with no hour", () => {
  it("has a row for each `shop` destination, and for no other", async () => {
    const source = await readFile(SETTINGS_PAGE, "utf8");
    const doors = new Set(Array.from(source.matchAll(DOOR_HREF), (match) => match[1] as string));

    for (const destination of STAFF_DESTINATIONS) {
      // Settings is the page, not a row on itself.
      if (destination.id === "settings") continue;
      expect(doors.has(destination.suffix), `${destination.id} (${destination.suffix})`).toBe(
        destination.place === "shop",
      );
    }

    // **And no door pointing at something that is not a destination at all.**
    // The loop above only ever looks *up* suffixes the registry already knows,
    // so a row pointing somewhere it has never heard of is invisible to it —
    // which is the hole `sourcery-ai` found on #1939.
    //
    // Settings' own sub-pages are the deliberate exception, and the reason the
    // fix is not a plain set equality: `/settings/boats`, `/settings/seasons`,
    // `/settings/security` and a dozen more are surfaces *under* this page
    // rather than destinations, so the registry does not know them and should
    // not. Anything else — a door to a top-level `/shop/<slug>/<something>`
    // with no row in `STAFF_DESTINATIONS` — is a destination declared outside
    // the one file a destination may be declared in.
    const shopSuffixes = new Set(
      STAFF_DESTINATIONS.filter((destination) => destination.place === "shop").map(
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
