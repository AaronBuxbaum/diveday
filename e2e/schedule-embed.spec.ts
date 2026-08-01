import { expect, test } from "./fixtures";
import { daysFromNow, e2eNow, signInAsOwner, signOut } from "./helpers";

/**
 * The embed widget (docs ADR 20260726-schedule-embed): a shop pastes the
 * schedule into its own website, so the two things that must hold are (1) the
 * embed route actually renders compact and framable, and (2) nothing else on
 * the site became framable as a side effect of adding that exception.
 */
test("the schedule embed renders without page chrome and allows framing", async ({ page }) => {
  const response = await page.goto("/shop/blue-mantis/schedule?embed=1");
  expect(response?.headers()["x-frame-options"]).toBeUndefined();
  expect(response?.headers()["content-security-policy"]).toBeUndefined();
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).not.toBeVisible();
});

test("a non-embed page still denies framing", async ({ page }) => {
  const response = await page.goto("/shop/blue-mantis/schedule");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
});

test("a repeated embed param can't smuggle framing past what the page actually renders", async ({
  page,
}) => {
  // searchParams.get() would silently take just the first "1" here while the
  // page's own searchParams prop sees the whole repeated param as an array
  // (never "1") and renders full chrome — the proxy must deny framing in
  // lockstep, not grant the exception on a value the page itself refused.
  const response = await page.goto("/shop/blue-mantis/schedule?embed=1&embed=0");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
});

test("embedded pages stay chrome-free even for a signed-in staff member", async ({ page }) => {
  // A shop owner might click their own embed link while signed in — the
  // iframe on their external site must never expose the staff nav, demo
  // banner, or offline-manifest sync regardless of who's viewing it.
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule?embed=1");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Today" })).not.toBeVisible();
});

test("booking through the embed keeps embed mode through the confirmation", async ({ page }) => {
  const title = `Embed Booking Check ${e2eNow().getTime()}`;
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(6));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Capacity").fill("6");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await signOut(page);

  await page.goto("/shop/blue-mantis/schedule?embed=1", { waitUntil: "domcontentloaded" });
  await page.locator("li, a").filter({ hasText: title }).first().click();
  await expect(page).toHaveURL(/embed=1/);
  await expect(page.getByRole("link", { name: "← All trips" })).toHaveCount(0);

  // The booking form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Embed Diver");
  await page.getByLabel("Email", { exact: true }).fill(`embed-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();

  await expect(page.getByRole("heading", { name: /You’re on the boat, Embed/ })).toBeVisible();
  // The redirect after a successful book-now-pay-later booking must have
  // carried embed=1 forward, or the confirmation reloads into full chrome.
  await expect(page).toHaveURL(/embed=1/);
  await expect(page.getByRole("link", { name: "← All trips" })).toHaveCount(0);
  const backLink = page.getByRole("link", { name: "Back to the schedule" });
  await expect(backLink).toHaveAttribute("href", /embed=1/);
});

test("the embed widget carries a discreet Powered-by-DiveDay attribution link with UTM params", async ({
  page,
}) => {
  // Human-discovery footer (task: embed attribution) — small, at the bottom,
  // and still zero JSON-LD (docs ADR 20260726-schedule-embed / the embed
  // canonicalizes to the standalone page, see reviews.spec.ts's parallel
  // assertion on the base case).
  await page.goto("/shop/blue-mantis/schedule?embed=1");
  const attribution = page.getByRole("link", { name: "Powered by DiveDay" });
  await expect(attribution).toBeVisible();
  const href = await attribution.getAttribute("href");
  expect(href).toContain("utm_source=embed");
  expect(href).toContain("utm_medium=widget");
  expect(href).toContain("utm_campaign=blue-mantis");
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
});

test("the non-embed schedule page carries no Powered-by-DiveDay attribution link", async ({
  page,
}) => {
  // The footer is embed-only — the standalone page already carries DiveDay
  // branding via its own chrome, and this link exists purely for a diver who
  // discovers the widget on a shop's own site.
  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByRole("link", { name: "Powered by DiveDay" })).toHaveCount(0);
});

// The e2e fleet runs `next start` (production mode) against a loopback
// origin with no APP_HOST set, and publicAppUrl() refuses a loopback origin
// in production (src/lib/notifications/index.ts checkPublicHost) — so this
// environment can only ever exercise the "hosting isn't configured" branch,
// never the live-snippet one. That's still a real, user-reachable state
// (any deploy that forgets APP_HOST lands here too), and it's what's worth
// locking in here; the snippet-generation string logic itself is simple
// interpolation covered by reading the page's source.
test("settings/embed asks for hosting setup when no public origin is configured", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/settings/embed");
  await expect(page.getByRole("heading", { name: "Website embed" })).toBeVisible();
  await expect(page.getByText(/configured public hosting address/)).toBeVisible();
});
