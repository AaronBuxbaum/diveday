import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { acceptAgeAttestation, e2eNow, openTripInEmbed } from "./helpers";

const diver = diverTranslator("en-US");
const memoryPrefix = "diveday:returning-diver:v2:";

async function storedMemory(page: import("@playwright/test").Page, shopSlug: string) {
  return page.evaluate(
    ({ prefix }) => {
      const key = Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index),
      ).find((candidate) => candidate?.startsWith(prefix));
      const raw = key ? localStorage.getItem(key) : null;
      return raw ? JSON.parse(raw) : null;
    },
    { prefix: `${memoryPrefix}${shopSlug}:` },
  );
}

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
  await expect.poll(() => storedMemory(page, "blue-mantis")).toBeTruthy();
  const stored = await storedMemory(page, "blue-mantis");
  expect(stored).toMatchObject({
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
  expect(await storedMemory(page, "blue-mantis")).toBeNull();
  await expect(page.getByRole("checkbox", { name: diver("booking.rememberOnDevice") })).toHaveCount(
    0,
  );
});

test("opening a booking form purges expired memory entries for other shops", async ({ page }) => {
  const expiredShopKey = "diveday:returning-diver:v2:red-reef:00000000-0000-4000-8000-000000000001";
  await page.goto("/s/blue-mantis");
  await page.evaluate(
    ({ key, expiredAt }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          fullName: "Priya Shah",
          email: "priya@example.com",
          expiresAt: expiredAt,
        }),
      ),
    { key: expiredShopKey, expiredAt: e2eNow().getTime() - 1 },
  );
  await page
    .locator("li")
    .filter({ hasText: "Discover Scuba — Pool & Reef" })
    .getByRole("link", { name: "Discover Scuba — Pool & Reef" })
    .click();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), expiredShopKey))
    .toBeNull();
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
  await expect.poll(() => storedMemory(page, "blue-mantis")).toBeNull();
  const forged = new URL(page.url());
  forged.searchParams.set("booked", "1");
  await page.goto(forged.toString());
  await expect(page.getByRole("heading", { name: /You’ve got a seat, Marco/ })).toBeVisible();
  await expect.poll(() => storedMemory(page, "blue-mantis")).toBeNull();
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
  await expect.poll(() => storedMemory(page, "blue-mantis")).toBeNull();
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
    expect(await storedMemory(page, "blue-mantis")).toBeNull();
    releaseReceipt();
    await expect.poll(() => storedMemory(page, "blue-mantis")).toBeTruthy();
  } finally {
    releaseReceipt();
    await page.unroute("**/ready/**");
  }
});
