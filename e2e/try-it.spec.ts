import { expect, test } from "./fixtures";

/**
 * **Try it with your boats** — the homepage hero that takes three words and
 * redraws as the visitor's own first day (ADR 20260908-one-hand, decision 6,
 * possibility Y).
 *
 * The claim this spec exists to hold is the whole point of the slice: what a
 * visitor types into DiveDay's homepage is still there, unretyped, on the door
 * they open — and if they walk through it, the boat and the departure they
 * imagined are real rows on their own board a moment later.
 *
 * The browser clock and zone are pinned by the fleet (`E2E_FROZEN_CLOCK`,
 * `timezoneId` in `playwright.config.ts`), so the greeting band, the countdown
 * and the rendered time are the same on every run and on every machine.
 */

const SHOP = "Coral Cove Dive Co.";
const BOAT = "Reef Runner";
/** Ahead of the frozen 09:30 local clock, so the countdown counts down today. */
const DEPARTURE = "11:00";

async function drawTheDay(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Your shop").fill(SHOP);
  await page.getByLabel("A boat").fill(BOAT);
  await page.getByLabel("First departure").fill(DEPARTURE);
  await page.getByRole("button", { name: "Draw my day" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Good morning, ${SHOP}` }),
  ).toBeVisible();
}

test("the hero redraws as the visitor's own first day, and says where it came from", async ({
  page,
}) => {
  await page.goto("/");

  // Before: the hero it has always been, plus three fields and a button that
  // is inert until there is something to draw.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Who is booked, who is cleared, and who is on the boat. One answer, all day.",
  );
  await expect(page.getByRole("button", { name: "Draw my day" })).toBeDisabled();

  await page.getByLabel("Your shop").fill(SHOP);
  await page.getByLabel("A boat").fill(BOAT);
  await page.getByLabel("First departure").fill(DEPARTURE);
  await expect(page.getByRole("button", { name: "Draw my day" })).toBeEnabled();
  await page.getByRole("button", { name: "Draw my day" }).click();

  // After: their name in the chrome, the app's own greeting, their boat on the
  // line at the time they typed, and the countdown against their own clock.
  await expect(
    page.getByRole("heading", { level: 1, name: `Good morning, ${SHOP}` }),
  ).toBeVisible();
  await expect(page.getByText(`${BOAT} is on the line at 11:00 AM`)).toBeVisible();
  await expect(page.getByText(`${BOAT} leaves in 1 hr 30 min.`)).toBeVisible();

  // The line that keeps the drawing honest, and the one that says what has and
  // has not happened yet. DiveDay looked nothing up and stored nothing.
  await expect(page.getByText("Drawn from what you typed")).toBeVisible();
  await expect(page.getByText("Nothing is saved until you open it.")).toBeVisible();

  // The way back, so a typo is not a page reload.
  await page.getByRole("button", { name: "Type it again" }).click();
  await expect(page.getByLabel("Your shop")).toHaveValue(SHOP);
});

test("the door the drawn hero opens is already filled in", async ({ page }) => {
  await drawTheDay(page);

  await page.getByRole("link", { name: `Open ${SHOP}` }).click();
  await page.waitForURL(/\/onboard\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get("from")).toBe("home-drawn");
  expect(url.searchParams.get("shop")).toBe(SHOP);
  expect(url.searchParams.get("boat")).toBe(BOAT);
  expect(url.searchParams.get("departure")).toBe(DEPARTURE);
  // The colour is derived from the name, not chosen — `#rrggbb`, lowercase,
  // through Harbor's contrast derivation before it ever reaches this URL.
  expect(url.searchParams.get("color")).toMatch(/^#[0-9a-f]{6}$/);

  // Nothing to retype: the name, the link it writes itself, the boat and the
  // departure are all in their boxes.
  const visible = (name: string) => page.locator(`input[name="${name}"]`).filter({ visible: true });
  await expect(visible("shopName")).toHaveValue(SHOP);
  await expect(visible("shopSlug")).toHaveValue("coral-cove-dive-co");
  await expect(visible("boat")).toHaveValue(BOAT);
  await expect(visible("departure")).toHaveValue(DEPARTURE);
});

test("opening the door writes the boat and the first departure the visitor drew", async ({
  page,
}) => {
  // Sized at its own site, the way `onboard.spec.ts`'s empty-doors test is:
  // this one draws the hero, walks the sign-up door, and waits on a *write* —
  // the shop, the owner, the account, the boat and the departure in one
  // submit — before two more blocking navigations. It lands in about seven
  // seconds idle and ran out of the 15s ceiling on a loaded box, which is the
  // outlier shape playwright.config.ts's comment describes.
  test.setTimeout(30_000);
  const unique = `try-it-${Date.now()}`;
  await drawTheDay(page);
  await page.getByRole("link", { name: `Open ${SHOP}` }).click();
  await page.waitForURL(/\/onboard\?/);

  const visible = (name: string) => page.locator(`input[name="${name}"]`).filter({ visible: true });
  // This run needs a slug of its own; everything else stands as the hero left it.
  await visible("shopSlug").fill(unique);
  await visible("ownerName").fill("Marisol Vega");
  await visible("ownerEmail").fill(`${unique}@example.com`);
  await visible("ownerPassword").fill("trial-pass-123");
  await page.getByRole("button", { name: "Create shop & start trial" }).click();
  await page.waitForURL(new RegExp(`/shop/${unique}$`));

  // The departure is a real row on the shop's own board — tomorrow, at the
  // time they typed, on the hull they named.
  await page.goto(`/shop/${unique}/schedule/board`);
  await expect(page.getByText(BOAT).first()).toBeVisible();

  // And a diver can already see it. The storefront also wears the colour the
  // hero suggested, which is what `BrandStyle` emits for a shop that has one.
  await page.goto(`/s/${unique}`);
  await expect(page.getByText(BOAT).first()).toBeVisible();
  await expect(page.locator("style[data-brand-style]")).toHaveCount(1);
});
