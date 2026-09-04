import { describe, expect, it } from "vitest";
import { DEMO_STORY_IDS, DEMO_STORY_ROLE } from "@/lib/demo-stories";
import { seededShopContext } from "@/test/db";
import { demoStoryPath } from "./demo-stories";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **The three stories the live demo tells** (issue #1215, delight report D55).
 *
 * Against the seeded shop rather than fabricated rows, because what these
 * assert is that a *freshly minted demo* can actually tell each story — a
 * destination that resolves only against hand-made data is a demo door that
 * dead-ends the first prospect who opens it.
 */
describe("demoStoryPath", () => {
  it("opens the first booking on the shop's own public page, with no session needed", async () => {
    const { db, shop } = await seededShopContext();
    expect(await demoStoryPath(db, shop.id, shop.slug, "first-booking")).toBe(`/s/${shop.slug}`);
  });

  it("opens the returning diver on a prep list that has somebody on it", async () => {
    const { db, shop } = await seededShopContext();
    const path = await demoStoryPath(db, shop.id, shop.slug, "returning-diver");
    expect(path).toMatch(new RegExp(`^/shop/${shop.slug}/trips/[0-9a-f-]+/prep$`));

    // The departure it picked really does have divers aboard — an empty prep
    // list shows the shop knowing nothing about nobody, which is not the story.
    const tripId = path.split("/")[4];
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((t) => t.id === tripId);
    expect(trip?.booked ?? 0).toBeGreaterThan(0);
  });

  /**
   * **The story opens with the departure still running.** Pre-cancelling it
   * would seed a trouble state into a demo — the thing AGENTS.md refuses — and
   * would take away the only part of the story that shows the crew handling
   * anything. So the destination is the confirm page, and the trip it names is
   * still `scheduled`.
   */
  it("opens the weather day on a departure nobody has cancelled yet", async () => {
    const { db, shop } = await seededShopContext();
    const path = await demoStoryPath(db, shop.id, shop.slug, "weather-day");
    expect(path).toMatch(new RegExp(`^/shop/${shop.slug}/schedule/blowout/[0-9a-f-]+$`));

    const tripId = path.split("/").pop();
    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    const trip = upcoming.find((t) => t.id === tripId);
    // `upcomingTripsWithCounts` only returns `scheduled` departures, so finding
    // it there is the assertion that nothing was blown out on the way in.
    expect(trip, "the weather day's departure was already cancelled").toBeTruthy();
    // The fullest boat: a blow-out with one diver aboard understates the cascade.
    expect(trip?.booked).toBe(Math.max(...upcoming.map((t) => t.booked)));
    expect(trip?.booked ?? 0).toBeGreaterThan(0);
  });

  /**
   * A destination behind a permission the story's own role does not hold is a
   * demo door that opens on a refusal. Only the owner may call a blow-out, and
   * the public schedule needs nobody at all.
   */
  it("tells each story as somebody who is allowed to be there", () => {
    expect(DEMO_STORY_ROLE["first-booking"]).toBe("diver");
    expect(DEMO_STORY_ROLE["weather-day"]).toBe("owner");
    for (const story of DEMO_STORY_IDS) expect(DEMO_STORY_ROLE[story]).toBeTruthy();
  });

  it("lands somewhere real for every story, never a dead end", async () => {
    const { db, shop } = await seededShopContext();
    for (const story of DEMO_STORY_IDS) {
      const path = await demoStoryPath(db, shop.id, shop.slug, story);
      expect(path.startsWith("/"), `${story} should be a path`).toBe(true);
      expect(path).not.toContain("undefined");
    }
  });
});
