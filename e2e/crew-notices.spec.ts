import type { APIRequestContext } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, openTripAbout, tripPathByTitle } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";
const CREW = "Marcus Webb";

type Preview = {
  pending: number;
  notification: {
    kind: string;
    changes: { change: string; tripTitle: string }[];
  } | null;
};

/** What the hourly pass would tell this person right now, sending nothing. */
async function preview(request: APIRequestContext, personName: string): Promise<Preview> {
  const response = await request.post("/api/test/crew-notices", {
    data: { shopSlug: SHOP, personName },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as Preview;
}

/**
 * **Crew hear about their boats** (ADR 20261009-crew-hear-about-their-boats).
 *
 * The owner puts a crew member on a departure from the departure's own Crew
 * panel, which is the door most crew changes come through. The write path
 * records the news for the crew member, and the message the hourly pass would
 * send names the departure. Taking them off again before the pass runs leaves
 * nothing to say about it.
 */
test.describe("a crew member put on a departure", () => {
  test("is owed one line about it, and none once it is undone", async ({ page, request }) => {
    const title = `Crew news ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(5),
      departsAt: "14:00",
      returnsAt: "16:00",
    });

    await page.goto(await tripPathByTitle(page, SHOP, title));
    await openTripAbout(page);
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: CREW });
    await expect(page.getByRole("button", { name: `Unassign ${CREW}` })).toBeVisible();

    const owed = await preview(request, CREW);
    expect(owed.notification?.kind).toBe("crew_schedule_change");
    expect(owed.notification?.changes).toContainEqual(
      expect.objectContaining({
        change: "assigned",
        tripTitle: title,
        startsAt: expect.any(String),
        tripUrl: expect.stringContaining("/trips/"),
      }),
    );

    await page.getByRole("button", { name: `Unassign ${CREW}` }).click();
    await expect(page.getByLabel("Assign crew")).toBeVisible();
    await expect(page.getByRole("button", { name: `Unassign ${CREW}` })).toHaveCount(0);

    // On, then off, before it settled: the same departure is no longer news.
    const undone = await preview(request, CREW);
    expect(undone.pending).toBeGreaterThan(owed.pending);
    expect(
      (undone.notification?.changes ?? []).filter((change) => change.tripTitle === title),
    ).toEqual([]);
  });
});
