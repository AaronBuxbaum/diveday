import { expect, test } from "./fixtures";

/**
 * **The three stories the live demo tells** (issue #1215, delight report D55),
 * each behind a stable link somebody can paste into an email to a shop owner.
 *
 * Every entry mints a whole seeded shop, which is what the owner's ruling means
 * by "each resetting its state on entry" — so these specs assert where a story
 * *lands*, and that it lands on a real product surface rather than an overlay.
 */

test("the first-booking story opens the shop's own public page, with no sign-in", async ({
  page,
}) => {
  await page.goto("/demo/first-booking");
  await expect(page.getByRole("heading", { level: 1, name: "A first booking" })).toBeVisible();
  await page.getByRole("button", { name: "Open this story" }).click();

  // The customer's view of a shop that did not exist a moment ago — the public
  // schedule, which needs no session at all.
  //
  // The demo banner rides above `/s/**` on a demo tenant as well as `/shop/**`,
  // so its absence is not what makes this the customer's view. The staff nav is:
  // none of the tabs a signed-in shop works from are on this page.
  await expect(page).toHaveURL(/\/s\/[^/]+$/);
  await expect(page.getByRole("link", { name: "Board", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Check-in", exact: true })).toHaveCount(0);
});

test("the returning-diver story opens a prep list the shop already knows things about", async ({
  page,
}) => {
  await page.goto("/demo/returning-diver");
  await expect(
    page.getByRole("heading", { level: 1, name: "A diver who has been before" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open this story" }).click();

  await expect(page).toHaveURL(/\/shop\/[^/]+\/trips\/[^/]+\/prep$/);
  // Signed in as somebody who preps boats, on a real staff surface.
  await expect(page.getByText("Demo shop")).toBeVisible();
});

/**
 * **The departure is still running when the story opens.** Pre-cancelling it
 * would seed a trouble state into a demo, which AGENTS.md refuses, and would
 * take away the only part of the story that shows the crew handling anything —
 * so the visitor lands on the confirm page and makes the call themselves.
 */
test("the weather-day story opens on a departure nobody has cancelled yet", async ({ page }) => {
  await page.goto("/demo/weather-day");
  await expect(
    page.getByRole("heading", { level: 1, name: "A day the weather takes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open this story" }).click();

  await expect(page).toHaveURL(/\/shop\/[^/]+\/schedule\/blowout\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Call a blow-out?" })).toBeVisible();

  // And the act itself works from here, which is the story.
  await page.getByRole("button", { name: "Call the blow-out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Blow-out cascade" })).toBeVisible();
});

test("a story nobody wrote is a dead end, not a door into a minted shop", async ({ page }) => {
  // Content-level, not `response?.status()`, for the reason `/switching/
  // [competitor]`'s spec sets out at length: `generateStaticParams` prerenders
  // only the three stories, so an unknown one falls back to a dynamic render,
  // and cacheComponents' Partial Prerendering serves an optimistic 200 shell
  // for a dynamic-param combination it has no static shell for. There is no
  // per-route opt-out — `dynamicParams` is refused outright under
  // `nextConfig.cacheComponents`. The document still lands on Next's own
  // not-found boundary, which is the fact worth pinning: a mistyped link out of
  // an email mints no shop and enters no demo.
  await page.goto("/demo/not-a-story");
  await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open this story" })).toHaveCount(0);
});
