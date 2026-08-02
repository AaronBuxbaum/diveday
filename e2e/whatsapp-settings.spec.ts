import type { Page } from "@playwright/test";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

const WHATSAPP_SETTINGS = "/shop/blue-mantis/settings/whatsapp";

/**
 * Connecting a shop's own WhatsApp Business number (docs ADR
 * 20260802-whatsapp-cloud-api-per-shop).
 *
 * The suite runs `fullyParallel` with one server and one in-memory database per
 * worker, so two of these landing on the same worker share a shop — and a
 * connection is shop state that survives between them. Every test therefore
 * normalises the connection first rather than assuming a clean slate, the same
 * way the calendar-subscription spec does.
 *
 * The test-send button is deliberately not exercised here: it makes a real call
 * to Meta, which the e2e fleet blocks on purpose
 * (`DIVEDAY_DISABLE_EXTERNAL_HTTP`). That path is covered by unit tests against
 * an injected fetch instead.
 */

const CREDENTIALS = {
  phoneNumberId: "109876543210987",
  accessToken: "EAAGtesttoken0000000000000wxyz",
  displayPhoneNumber: "+1 305-555-0142",
};

async function disconnectIfConnected(page: Page) {
  await page.goto(WHATSAPP_SETTINGS);
  const disconnect = page.getByRole("button", { name: "Disconnect WhatsApp" });
  if (await disconnect.isVisible().catch(() => false)) {
    await disconnect.click();
    await page.getByRole("heading", { name: "No WhatsApp number connected" }).waitFor();
  }
}

async function connect(page: Page) {
  await page.goto(WHATSAPP_SETTINGS);
  await page.getByLabel("Phone number ID").fill(CREDENTIALS.phoneNumberId);
  await page.getByLabel("Access token", { exact: true }).fill(CREDENTIALS.accessToken);
  await page.getByLabel("Display number (optional)").fill(CREDENTIALS.displayPhoneNumber);
  await page.getByRole("button", { name: /Connect WhatsApp|Save changes/ }).click();
  await page.getByRole("heading", { name: "WhatsApp connected" }).waitFor();
}

test.describe("WhatsApp settings", () => {
  signedInAsOwner();

  test("an owner connects the shop's own WhatsApp number", async ({ page }) => {
    await disconnectIfConnected(page);

    await expect(page.getByRole("heading", { name: "No WhatsApp number connected" })).toBeVisible();

    await connect(page);

    await expect(page.getByText(CREDENTIALS.displayPhoneNumber)).toBeVisible();
    // Saved is not the same as working — until a test message lands, the page
    // must not imply the connection is proven.
    await expect(page.getByText("Not tested yet")).toBeVisible();
  });

  test("the stored access token is never rendered back, only its last four", async ({ page }) => {
    await disconnectIfConnected(page);
    await connect(page);

    await expect(page.getByText("Ending in wxyz")).toBeVisible();
    // The whole point of sealing it: nothing on this page, in any form value or
    // attribute, can carry the credential back out.
    expect(await page.content()).not.toContain(CREDENTIALS.accessToken);
    await expect(page.getByLabel("Access token", { exact: true })).toHaveValue("");
  });

  test("disconnecting returns the courtesy channel to SMS", async ({ page }) => {
    await disconnectIfConnected(page);
    await connect(page);

    await page.getByRole("button", { name: "Disconnect WhatsApp" }).click();

    await expect(page.getByText("Courtesy messages will go out as SMS.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No WhatsApp number connected" })).toBeVisible();
  });

  test("rejects the phone number pasted where the phone number ID belongs", async ({ page }) => {
    await disconnectIfConnected(page);

    await page.goto(WHATSAPP_SETTINGS);
    await page.getByLabel("Phone number ID").fill("+1 305-555-0142");
    await page.getByLabel("Access token", { exact: true }).fill(CREDENTIALS.accessToken);
    await page.getByRole("button", { name: "Connect WhatsApp" }).click();

    await expect(page.getByText("Check the details and try again.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No WhatsApp number connected" })).toBeVisible();
  });
});

test.describe("WhatsApp settings authorization", () => {
  // A captain runs the boat but does not hold the shop's credentials.
  signedInAs("captain");

  test("a captain cannot reach WhatsApp settings", async ({ page }) => {
    await page.goto(WHATSAPP_SETTINGS);

    // Bounced to the settings index with the shared not-authorized notice.
    await expect(page).toHaveURL(/\/settings\?notice=not_authorized$/);
    await expect(page.getByRole("heading", { name: "WhatsApp connected" })).toHaveCount(0);
  });

  test("and is not offered the link from the settings index", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings");

    await expect(page.getByRole("link", { name: "Set up WhatsApp" })).toHaveCount(0);
  });
});
