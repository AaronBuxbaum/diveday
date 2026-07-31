import type { Locator, Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";
import { signInAs, signInAsOwner } from "./helpers";

const CALENDAR_SETTINGS = "/shop/blue-mantis/settings/calendar";
const MY_DEPARTURES = "My departures";

/**
 * The suite runs `fullyParallel`, and each worker has its own server with its
 * own in-memory database — so tests on *different* workers are isolated, but
 * two of these landing on the same worker share one shop. A subscription is
 * per-person shop state that survives between them.
 *
 * Two consequences shape every test here. Locators are scoped to one panel by
 * its heading (a bare `.first()` on "Create subscription link" silently jumps
 * to the *other* scope's panel once this one is subscribed), and each test
 * normalises the subscription before asserting rather than assuming a clean
 * slate.
 */
function panelFor(page: Page, heading: string): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
}

/** The fetchable URL of the just-minted link — the second of the panel's two
 * (webcal first, then plain http(s)). Selecting by scheme would not work: the
 * e2e fleet serves http, so the "https" block holds an http://127.0.0.1 URL. */
function mintedUrl(panel: Locator): Locator {
  return panel.locator("p.font-mono").nth(1);
}

/** Leaves the panel with no live subscription, whatever state it started in. */
async function clearSubscription(panel: Locator, page: Page) {
  const turnOff = panel.getByRole("button", { name: "Turn off" });
  if ((await turnOff.count()) > 0) {
    page.once("dialog", (dialog) => dialog.accept());
    await turnOff.click();
    await expect(panel.getByRole("button", { name: "Create subscription link" })).toBeVisible();
  }
}

/** Mints a link from either state and returns its fetchable URL. */
async function mintLink(panel: Locator, page: Page): Promise<string> {
  const create = panel.getByRole("button", { name: "Create subscription link" });
  const replace = panel.getByRole("button", { name: "Replace link" });
  if ((await create.count()) > 0) {
    await create.click();
  } else {
    page.once("dialog", (dialog) => dialog.accept());
    await replace.click();
  }
  await expect(panel.getByRole("heading", { name: "Your subscription link" })).toBeVisible();
  return (await mintedUrl(panel).innerText()).trim();
}

test.describe("staff calendar subscriptions", () => {
  test("the Settings card teases the calendar page instead of repeating its full title and description", async ({
    page,
  }) => {
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/settings");
    const card = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Calendar subscriptions" }) });
    await expect(card).toBeVisible();
    // The card's own short teaser, not the full page's read-only explainer —
    // that longer sentence belongs to the destination page alone.
    await expect(
      card.getByText("Put your departures on the calendar app you already use"),
    ).toBeVisible();
    await expect(
      card.getByText(
        "Subscribing is read-only: DiveDay never reads or changes anything in your calendar.",
      ),
    ).toHaveCount(0);

    await card.getByRole("link", { name: "Manage subscriptions" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar subscriptions" }),
    ).toBeVisible();
  });

  test("an owner mints a feed and the URL serves their departures with no session", async ({
    page,
    request,
  }) => {
    await signInAsOwner(page);
    await page.goto(CALENDAR_SETTINGS);
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar subscriptions" }),
    ).toBeVisible();

    const panel = panelFor(page, MY_DEPARTURES);
    await clearSubscription(panel, page);
    // With nothing subscribed there is no link on screen to leak.
    await expect(panel.getByText("Not subscribed yet.")).toBeVisible();

    const url = await mintLink(panel, page);
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

  test("rotating a link kills the old URL immediately", async ({ page, request }) => {
    await signInAsOwner(page);
    await page.goto(CALENDAR_SETTINGS);
    const panel = panelFor(page, MY_DEPARTURES);
    await clearSubscription(panel, page);

    const firstUrl = await mintLink(panel, page);
    expect((await request.get(firstUrl, { headers: { cookie: "" } })).status()).toBe(200);

    // Re-render so the panel offers "Replace link" from server state, which is
    // the path a returning staff member actually takes.
    await page.reload();
    const secondUrl = await mintLink(panelFor(page, MY_DEPARTURES), page);

    expect(secondUrl).not.toBe(firstUrl);
    expect((await request.get(firstUrl, { headers: { cookie: "" } })).status()).toBe(404);
    expect((await request.get(secondUrl, { headers: { cookie: "" } })).status()).toBe(200);
  });

  test("turning a subscription off stops the feed", async ({ page, request }) => {
    await signInAsOwner(page);
    await page.goto(CALENDAR_SETTINGS);
    const panel = panelFor(page, MY_DEPARTURES);
    await clearSubscription(panel, page);

    const url = await mintLink(panel, page);
    expect((await request.get(url, { headers: { cookie: "" } })).status()).toBe(200);

    page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: "Turn off" }).click();
    await expect(panel.getByRole("button", { name: "Create subscription link" })).toBeVisible();

    expect((await request.get(url, { headers: { cookie: "" } })).status()).toBe(404);
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

  test("a captain gets their own departures but not the whole shop's", async ({ page }) => {
    await signInAs(page, DEV_STAFF_LOGINS.captain);
    await page.goto(CALENDAR_SETTINGS);

    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar subscriptions" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: MY_DEPARTURES, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All shop departures" })).toHaveCount(0);
  });
});
