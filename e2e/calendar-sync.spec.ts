import type { Locator, Page } from "@playwright/test";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

const CALENDAR_SETTINGS = "/shop/blue-mantis/settings/calendar";
const calendarSettingsFor = (shopSlug: string) => `/shop/${shopSlug}/settings/calendar`;
const MY_DEPARTURES = "My departures";

/**
 * A subscription is per-person shop state, and `calendar_feeds` is one of the
 * tables `resetDemoSchedule` deliberately leaves standing — it clears a feed
 * only when it purges the person who owns it, so the four permanent staff keep
 * theirs across the reset by design. Every test here that mints, rotates or
 * turns off a link therefore takes a shop of its own (`privateShop`, ADR
 * 20260815-per-test-private-shops) and signs in as that shop's owner.
 *
 * Before that, whatever state the last of them reached was what the rest of the
 * worker read — and two `e2e/visual.spec.ts` captures wait on "Create
 * subscription link", i.e. assume the owner has no live subscription at all.
 *
 * Locators are still scoped to one panel by its heading: an owner sees two
 * ("My departures" and "All shop departures"), so a bare `.first()` on a
 * control silently answers from the wrong one.
 */
function panelFor(page: Page, heading: string): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .filter({ visible: true });
}

/** The fetchable URL of the just-minted link — the second of the panel's two
 * (webcal first, then plain http(s)). Selecting by scheme would not work: the
 * e2e fleet serves http, so the "https" block holds an http://127.0.0.1 URL. */
function mintedUrl(panel: Locator): Locator {
  return panel.locator("p.font-mono").nth(1);
}

/**
 * Mints a link and returns its fetchable URL. A shop of the test's own starts
 * with nothing subscribed, so the first call takes the "Create subscription
 * link" path and a second call in the same test takes "Replace link" — which
 * is the state the rotation test is actually about.
 *
 * The panel has to be on screen before the branch is chosen. `count()` is a
 * snapshot, and on CI it answered 0 while the segment was still streaming in
 * behind its `loading.tsx` shell — which sent a never-subscribed shop down the
 * "Replace link" path, waiting on a button that shop can never show. Waiting
 * for whichever door the panel renders is what makes the choice deterministic.
 */
async function mintLink(panel: Locator): Promise<string> {
  const create = panel.getByRole("button", { name: "Create subscription link" });
  const replace = panel.getByRole("button", { name: "Replace link" });
  await expect(create.or(replace)).toBeVisible();
  if (await create.isVisible()) {
    await create.click();
  } else {
    await replace.click();
    await panel.getByRole("button", { name: "Yes, replace the link" }).click();
  }
  await expect(panel.getByRole("heading", { name: "Your subscription link" })).toBeVisible();
  return (await mintedUrl(panel).innerText()).trim();
}

test.describe("staff calendar subscriptions", () => {
  signedInAsOwner();

  test("the Settings row is a door, and says nothing about what is behind it", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings");
    // **Neither sentence, now.** This used to assert the row carried a short
    // teaser — "Put your departures on the calendar app you already use" —
    // distinct from the destination's longer read-only explainer, and the
    // distinction was the whole test. Slice 6g deleted all fourteen standing
    // captions from this hub (decision 6): a door row is its label and the
    // page it opens, and the explanation was always waiting on the other side
    // of the tap. So the assertion that survives is the stronger half — the
    // hub explains nothing — and it is checked against both sentences rather
    // than one.
    //
    // Scoped to `main` so the settings rail's own "Calendar subscriptions"
    // row cannot answer for the door.
    const main = page.getByRole("main");
    for (const caption of [
      "Put your departures on the calendar app you already use",
      "Subscribing is read-only: DiveDay never reads or changes anything in your calendar.",
    ]) {
      await expect(main.getByText(caption)).toHaveCount(0);
    }

    // The door itself is untouched: same label, same destination, same h1.
    await main.getByRole("link", { name: "Calendar subscriptions", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar subscriptions" }),
    ).toBeVisible();
    // And the explainer the hub no longer carries is here, where it belongs.
    await expect(
      page.getByText(
        "Subscribing is read-only: DiveDay never reads or changes anything in your calendar.",
      ),
    ).toBeVisible();
  });

  test("an unknown feed token is a plain 404, never an existence oracle", async ({ request }) => {
    for (const path of [
      "/calendar/not-a-real-token.ics",
      "/calendar/not-a-real-token",
      `/calendar/${"a".repeat(43)}.ics`,
    ]) {
      expect((await request.get(path, { headers: { cookie: "" } })).status()).toBe(404);
    }
  });
});

/**
 * The half that writes a `calendar_feeds` row — each on a shop of its own, so
 * the subscription it leaves behind belongs to a shop nothing else reads. No
 * `signedInAsOwner()`: the fixture signs in as the minted shop's own owner.
 */
test.describe("staff calendar subscriptions, on a shop of the test's own", () => {
  test("an owner mints a feed and the URL serves their departures with no session", async ({
    page,
    request,
    privateShop,
  }) => {
    // The mint and the live sign-in the fixture pays for come out of this
    // test's own budget.
    test.setTimeout(60_000);
    await page.goto(calendarSettingsFor(privateShop.slug));
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar subscriptions" }),
    ).toBeVisible();

    const panel = panelFor(page, MY_DEPARTURES);
    // A shop of the test's own has never subscribed, so there is no link on
    // screen to leak — and no normalisation step to perform first.
    await expect(panel.getByText("Not subscribed yet.")).toBeVisible();

    const url = await mintLink(panel);
    expect(url).toContain("/calendar/");
    expect(url).toMatch(/\.ics$/);
    expect(url).toMatch(/^https?:\/\//);

    // The URL *is* the capability: no cookie, still served.
    const feed = await request.get(url, { headers: { cookie: "" } });
    expect(feed.status()).toBe(200);
    expect(feed.headers()["content-type"]).toContain("text/calendar");
    expect(feed.headers()["cache-control"]).toContain("no-store");
    expect(feed.headers()["x-robots-tag"]).toContain("noindex");

    const body = await feed.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("X-WR-CALNAME:");
    expect(body.trimEnd()).toMatch(/END:VCALENDAR$/);
  });

  test("rotating a link kills the old URL immediately", async ({ page, request, privateShop }) => {
    test.setTimeout(60_000);
    await page.goto(calendarSettingsFor(privateShop.slug));
    const panel = panelFor(page, MY_DEPARTURES);

    const firstUrl = await mintLink(panel);
    expect((await request.get(firstUrl, { headers: { cookie: "" } })).status()).toBe(200);

    // Re-render so the panel offers "Replace link" from server state, which is
    // the path a returning staff member actually takes.
    await page.reload();
    const secondUrl = await mintLink(panelFor(page, MY_DEPARTURES));

    expect(secondUrl).not.toBe(firstUrl);
    expect((await request.get(firstUrl, { headers: { cookie: "" } })).status()).toBe(404);
    expect((await request.get(secondUrl, { headers: { cookie: "" } })).status()).toBe(200);
  });

  test("turning a subscription off stops the feed", async ({ page, request, privateShop }) => {
    test.setTimeout(60_000);
    await page.goto(calendarSettingsFor(privateShop.slug));
    const panel = panelFor(page, MY_DEPARTURES);

    const url = await mintLink(panel);
    expect((await request.get(url, { headers: { cookie: "" } })).status()).toBe(200);

    await panel.getByRole("button", { name: "Turn off" }).click();
    await panel.getByRole("button", { name: "Yes, turn it off" }).click();
    await expect(panel.getByRole("button", { name: "Create subscription link" })).toBeVisible();

    expect((await request.get(url, { headers: { cookie: "" } })).status()).toBe(404);
  });
});

test.describe("staff calendar subscriptions, as captain", () => {
  signedInAs("captain");

  test("a captain gets their own departures but not the whole shop's", async ({ page }) => {
    await page.goto(CALENDAR_SETTINGS);

    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar subscriptions" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: MY_DEPARTURES, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All shop departures" })).toHaveCount(0);
  });
});
