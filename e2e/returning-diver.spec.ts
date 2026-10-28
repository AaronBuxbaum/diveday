import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { acceptAgeAttestation, e2eNow, openTripInEmbed } from "./helpers";

const diver = diverTranslator("en-US");
const memoryKey = "diveday:returning-diver:v2:blue-mantis";

test("a device that just booked prefills the next booking form, with a one-tap way out", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Discover Scuba — Pool & Reef" })
    .getByRole("link", { name: "Discover Scuba — Pool & Reef" })
    .click();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  const remember = page.getByRole("checkbox", { name: diver("booking.rememberOnDevice") });
  await expect(remember).not.toBeChecked();
  await page.getByLabel("Name", { exact: true }).fill("Marco Reyes");
  await page.getByLabel("Email", { exact: true }).fill("marco@example.com");
  await remember.check();
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
  await expect(page).toHaveURL(/\/ready\/[A-Za-z0-9_-]+/);
  const confirmationUrl = new URL(page.url());
  confirmationUrl.searchParams.set("booked", "1");
  const confirmationResponse = await page.request.get(confirmationUrl.toString());
  expect(confirmationResponse.ok()).toBe(true);
  expect(await confirmationResponse.text()).toContain("You’ve got a seat, Marco");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), memoryKey))
    .toBeTruthy();
  const stored = await page.evaluate((key) => localStorage.getItem(key), memoryKey);
  expect(JSON.parse(stored ?? "null")).toEqual({
    fullName: "Marco Reyes",
    email: "marco@example.com",
    expiresAt: e2eNow().getTime() + 30 * 24 * 60 * 60 * 1000,
  });

  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Marco Reyes");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("marco@example.com");
  await expect(page.getByText("Booking as", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Not you?" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  await expect(page.getByText("Booking as", { exact: false })).not.toBeVisible();
});

test("the embed widget never prefills or remembers a booker", async ({ page }) => {
  await page.goto("/s/blue-mantis?embed=1");
  await openTripInEmbed(page, "Discover Scuba — Pool & Reef");
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Sal Moretti");
  await page.getByLabel("Email", { exact: true }).fill("sal@example.com");
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’ve got a seat, Sal/ })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), memoryKey)).toBeNull();
  await expect(page.getByRole("checkbox", { name: diver("booking.rememberOnDevice") })).toHaveCount(
    0,
  );
});

test("a successful booking without opt-in and a forged confirmation flag do not save identity", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Discover Scuba — Pool & Reef" })
    .getByRole("link", { name: "Discover Scuba — Pool & Reef" })
    .click();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Marco Reyes");
  await page.getByLabel("Email", { exact: true }).fill("marco@example.com");
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’ve got a seat, Marco/ })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), memoryKey)).toBeNull();
  const forged = new URL(page.url());
  forged.searchParams.set("booked", "1");
  await page.goto(forged.toString());
  await expect(page.getByRole("heading", { name: /You’ve got a seat, Marco/ })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), memoryKey)).toBeNull();
});

test("a refused repeat booking cannot create device memory", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Discover Scuba — Pool & Reef" })
    .getByRole("link", { name: "Discover Scuba — Pool & Reef" })
    .click();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Marco Reyes");
  await page.getByLabel("Email", { exact: true }).fill("repeat@example.com");
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’ve got a seat, Marco/ })).toBeVisible();
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Discover Scuba — Pool & Reef" })
    .getByRole("link", { name: "Discover Scuba — Pool & Reef" })
    .click();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Marco Reyes");
  await page.getByLabel("Email", { exact: true }).fill("repeat@example.com");
  await page.getByRole("checkbox", { name: diver("booking.rememberOnDevice") }).check();
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
  await expect(page).toHaveURL(/\bsent=1\b/);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), memoryKey)).toBeNull();
});

test("the booked confirmation stays visible while the opt-in receipt is still redeeming", async ({
  page,
}) => {
  let releaseReceipt!: () => void;
  let markPaused!: () => void;
  const receiptGate = new Promise<void>((resolve) => {
    releaseReceipt = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    markPaused = resolve;
  });
  let isPaused = false;
  await page.route("**/ready/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      isPaused = true;
      markPaused();
      await receiptGate;
    }
    await route.continue();
  });
  try {
    await page.goto("/s/blue-mantis");
    await page
      .locator("li")
      .filter({ hasText: "Discover Scuba — Pool & Reef" })
      .getByRole("link", { name: "Discover Scuba — Pool & Reef" })
      .click();
    await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    await page.getByLabel("Name", { exact: true }).fill("Marco Reyes");
    await page.getByLabel("Email", { exact: true }).fill("slow-receipt@example.com");
    await page.getByRole("checkbox", { name: diver("booking.rememberOnDevice") }).check();
    await acceptAgeAttestation(page);
    await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
    await expect(page.getByRole("heading", { name: /You’ve got a seat, Marco/ })).toBeVisible();
    await paused;
    expect(isPaused).toBe(true);
    expect(await page.evaluate((key) => localStorage.getItem(key), memoryKey)).toBeNull();
    releaseReceipt();
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), memoryKey))
      .toBeTruthy();
  } finally {
    releaseReceipt();
    await page.unroute("**/ready/**");
  }
});
