import { expect, signedInAsOwner, test } from "./fixtures";
import { capture } from "./visual-capture";

signedInAsOwner();

test("one waiver button sends a resumable link and a medical yes surfaces follow-up", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
  // The roster and its waiver control live on the Guests tab.
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await page.waitForURL(/\/guests/);
  const staffTripUrl = page.url();

  const diverSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Divers/ }) });
  // The whole waiver is a single button; for an unsent diver it reads "Send
  // waiver". Exact, so it targets the per-diver control and not the roster's
  // "Send waivers to selected" bulk button.
  await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Private waiver link ready" })).toBeVisible();
  const waiverHref = await page
    .getByRole("link", { name: "Open waiver link" })
    .getAttribute("href");
  expect(waiverHref).toMatch(/^\/waivers\//);

  await page.goto(waiverHref ?? "/");
  await expect(page.getByRole("heading", { name: "A quick step before the dock" })).toBeVisible();
  await page.getByLabel("Type your full name").fill("Priya Sharma");
  await page.getByLabel("I have read this waiver, understand it, and agree to it.").check();
  await page.getByRole("button", { name: "Save and finish later" }).click();
  await expect(page.getByRole("status")).toContainText("progress is saved");
  await expect(page.getByLabel("Type your full name")).toHaveValue("Priya Sharma");

  // The first question's affirmative answer must not disappear into a generic
  // success state; it becomes an explicit staff follow-up item.
  await page.getByRole("radio", { name: "Yes" }).first().check();
  await page.getByRole("button", { name: "Sign waiver" }).click();
  // The completed state's EarnedMoment is this page's only heading — assert
  // the level explicitly so a regression back to <h2> (no <h1> on the page at
  // all) fails here instead of silently passing a level-agnostic query.
  await expect(page.getByRole("heading", { name: "Waiver received", level: 1 })).toBeVisible();
  // The copy uses a typographic apostrophe (U+2019), not a straight one.
  await expect(page.getByText(/doctor’s sign-off may be required/)).toBeVisible();
  // The done screen sends the diver onward to their readiness page, not a dead
  // end back to the shop home.
  await expect(page.getByRole("link", { name: /left before you sail/ })).toBeVisible();

  // Assert scheduled dive site cards are rendered (delight feature)
  await expect(page.getByRole("heading", { name: "Your scheduled dive sites" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Molasses Reef" })).toBeVisible();

  // Back on the roster, the single button now reports the completed-but-flagged
  // state, and the medical answer is spelled out for staff follow-up.
  await page.goto(staffTripUrl);
  await expect(diverSection.getByText("Medical review", { exact: true })).toBeVisible();
  await expect(diverSection.getByText("Follow up before boarding")).toBeVisible();
});

test("staff edit the single shop waiver and each edit is kept as a version", async ({ page }) => {
  await page.goto("/shop/blue-mantis/waivers");

  const release = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Release text" }) });

  // The current version is shown, and the release text is directly editable.
  await expect(release.getByText("Version 1")).toBeVisible();

  // Editing pre-fills the current text and saves a new version rather than
  // mutating the one divers may already have signed. Title is immutable.
  const releaseTextarea = page.getByLabel("Release text");
  await expect(releaseTextarea).toHaveValue(/scuba diving/);
  await releaseTextarea.fill(
    "Revised release: I accept the inherent risks of boat charters and open-water diving for this trip.",
  );
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("status")).toContainText("new version");

  // The current card advances to v2.
  await expect(release.getByText("Version 2")).toBeVisible();
});

// Visual regression capture for this file's surface (see e2e-and-visual
// skill / e2e/visual-capture.ts). Moved here from the old e2e/visual.spec.ts
// "site tour".
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, { tag: "@visual" }, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      // Overrides this file's own signedInAsOwner() above: the diver-facing
      // waiver page is a bearer-token capability surface, not gated by staff
      // auth, and the baseline should be what an actual diver sees — a
      // signed-out visitor — not a staff session that happens to also hold
      // the link.
      storageState: undefined,
    });

    test(`the active waiver page renders true to the design (${scheme})`, async ({
      page,
      browser,
      ownerStorageState,
    }) => {
      // Mint a real, unsent waiver link via a disposable staff context so
      // `page` itself stays the same unauthenticated visitor throughout,
      // exactly as a real diver reaches this link (CR-019).
      const staffContext = await browser.newContext({ storageState: ownerStorageState });
      const staffPage = await staffContext.newPage();
      await staffPage.goto("/shop/blue-mantis/schedule");
      await staffPage
        .locator("li")
        .filter({ hasText: "Two-Tank Reef — Molasses & French" })
        .getByRole("link")
        .click();
      await staffPage.waitForURL(/\/shop\/blue-mantis\/trips\//);
      await staffPage
        .getByRole("navigation", { name: "Trip" })
        .getByRole("link", { name: "Guests" })
        .click();
      await staffPage.waitForURL(/\/guests/);
      const diverSection = staffPage
        .locator("section")
        .filter({ has: staffPage.getByRole("heading", { name: /^Divers/ }) });
      await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
      await staffPage.getByRole("heading", { name: "Private waiver link ready" }).waitFor();
      const waiverHref = await staffPage
        .getByRole("link", { name: "Open waiver link" })
        .getAttribute("href");
      await staffContext.close();

      // Active (unsigned) waiver — the safety-critical form itself, before any
      // signature or medical answer is entered.
      await page.goto(waiverHref ?? "/");
      await page.getByRole("heading", { name: "A quick step before the dock" }).waitFor();
      await capture(page, "waiver-active", scheme);
    });
  });
}
