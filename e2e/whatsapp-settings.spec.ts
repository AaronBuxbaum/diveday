import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

const WHATSAPP_SETTINGS = "/shop/blue-mantis/settings/whatsapp";

/**
 * The WhatsApp settings surface (docs ADR 20260802-whatsapp-embedded-signup).
 *
 * Connecting runs through Meta's own hosted Embedded Signup popup, which needs
 * Meta to have approved DiveDay's app — so on the e2e fleet, which configures no
 * `META_*` credentials, the page is in its coming-soon state. That is exactly
 * the state every shop sees today, and it is what these tests cover: the notice
 * is present, the button is inert, and the surface is still owner/manager work.
 *
 * The signup exchange itself is covered by unit tests against an injected fetch
 * (`src/lib/notifications/whatsapp-signup.test.ts`); it cannot be exercised here
 * without a live Meta app, and the fleet blocks external HTTP on purpose.
 */

test.describe("WhatsApp settings", () => {
  signedInAsOwner();

  test("tells a shop the connection is coming rather than offering a dead button", async ({
    page,
  }) => {
    await page.goto(WHATSAPP_SETTINGS);

    await expect(page.getByRole("heading", { name: "Coming soon" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No WhatsApp number connected" })).toBeVisible();
    // Present but inert: the shop can see what is coming, and cannot start a
    // flow that Meta would reject.
    await expect(page.getByRole("button", { name: "Connect WhatsApp" })).toBeDisabled();
  });

  test("says courtesy messages keep going out as SMS meanwhile", async ({ page }) => {
    await page.goto(WHATSAPP_SETTINGS);

    await expect(page.getByText("keep going out as SMS", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Courtesy reminders and recaps are going out as SMS.", { exact: false }),
    ).toBeVisible();
  });

  test("explains the flow without asking the shop for any credential", async ({ page }) => {
    await page.goto(WHATSAPP_SETTINGS);

    await expect(page.getByRole("heading", { name: "How connecting works" })).toBeVisible();
    // The whole point of Embedded Signup over the previous flow: no token, no
    // phone number id, nothing to copy across from Meta's tools.
    await expect(page.getByLabel("Access token")).toHaveCount(0);
    await expect(page.getByLabel("Phone number ID")).toHaveCount(0);
  });
});

test.describe("WhatsApp settings authorization", () => {
  // A captain runs the boat but does not hold the shop's credentials.
  signedInAs("captain");

  test("a captain cannot reach WhatsApp settings", async ({ page }) => {
    await page.goto(WHATSAPP_SETTINGS);

    // Asserted on the notice rather than the URL: the settings page clears its
    // own `?notice=` param client-side once shown, so a URL assertion races that
    // cleanup. The words are what the captain actually gets either way.
    await expect(
      page.getByText("Only an owner or manager can change WhatsApp settings."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coming soon" })).toHaveCount(0);
  });

  test("and is not offered the link from the settings index", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings");

    // Scoped to `main`: the settings sub-nav carries its own "WhatsApp" tab,
    // which is not the door row this asserts about.
    await expect(
      page.getByRole("main").getByRole("link", { name: "WhatsApp", exact: true }),
    ).toHaveCount(0);
  });
});
