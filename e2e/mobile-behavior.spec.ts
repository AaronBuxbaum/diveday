import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import type { OfflineManifestUpcomingResponse } from "../src/lib/offline-manifests";
import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openOnThisPhone, openThreadStep } from "./helpers";

const diver = diverTranslator("en-US");
const touchEvents = new WeakMap<Page, number>();

test.beforeEach(async ({ page, browserName, isMobile, hasTouch }, testInfo) => {
  expect(browserName).toBe(testInfo.project.name === "mobile-webkit" ? "webkit" : "chromium");
  expect(isMobile).toBe(true);
  expect(hasTouch).toBe(true);
  touchEvents.set(page, 0);
  await page.exposeBinding("recordMobileTouch", () => {
    touchEvents.set(page, (touchEvents.get(page) ?? 0) + 1);
  });
  await page.addInitScript(() => {
    document.addEventListener("touchstart", () => {
      void (window as unknown as { recordMobileTouch: () => Promise<void> }).recordMobileTouch();
    });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) {
    expect(touchEvents.get(page), "the engine delivered real touchstart events").toBeGreaterThan(0);
  }
});

test("touch navigation reaches the course catalog and returns to the schedule", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
  const nav = page.getByRole("navigation", { name: "Shop pages" });
  await nav.getByRole("link", { name: "Courses" }).tap();
  await expect(page).toHaveURL("/s/blue-mantis/courses");
  await expect(nav.getByRole("link", { name: "Courses" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Schedule" }).tap();
  await expect(page).toHaveURL("/s/blue-mantis");
  await expect(nav.getByRole("link", { name: "Schedule" })).toHaveAttribute("aria-current", "page");
});

test("touch booking and guardian signing stay complete after reload", async ({ page }) => {
  await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Book this boat" }).tap();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Mobile Minor");
  await page.getByLabel("Email", { exact: true }).fill("mobile-minor@example.com");
  await page.getByRole("checkbox", { name: /^Under 18/ }).tap();
  await page.getByRole("button", { name: /^Book/ }).tap();
  await expect(page).toHaveURL(/\/ready\//);
  const readyPath = new URL(page.url()).pathname;
  const sign = await openThreadStep(page, "sign");
  await sign.getByRole("button", { name: "Sign your waiver" }).tap();
  await expect(page.getByRole("heading", { name: "Parent or guardian" })).toBeVisible();
  await page.getByLabel("Type your full name").fill("Mobile Minor");
  await page.getByLabel(diver("waiver.agreementCheckbox")).tap();
  const answers = page.getByRole("radio", { name: "No", exact: true });
  await expect(answers).not.toHaveCount(0);
  for (const answer of await answers.all()) await answer.tap();
  await page.getByLabel("Guardian’s full name").fill("Mobile Parent");
  await page.getByLabel("Relationship to Mobile Minor").selectOption("parent");
  await page.getByLabel("I am this diver’s parent or legal guardian", { exact: false }).tap();
  await page.getByRole("button", { name: "Sign waiver", exact: true }).tap();
  await expect(page).toHaveURL(/\/ready\//);
  await page.goto(readyPath, { waitUntil: "domcontentloaded" });
  await expect(
    page.locator("li[data-thread-step='sign']").filter({ visible: true }),
  ).toHaveAttribute("data-step-state", "done");
});

test.describe("touch manifest", () => {
  signedInAsOwner();

  test("saved manifest reloads offline and reconciles a queued crew count", async ({
    page,
    context,
    request,
  }) => {
    // Read the seeded scenario through the real staff API; walking the board
    // is covered elsewhere and spends the offline journey's budget on setup.
    const seed = await request.get("/api/offline-manifests/upcoming");
    expect(seed.ok()).toBe(true);
    const initial: OfflineManifestUpcomingResponse = await seed.json();
    const payload = initial.payloads.find((entry) =>
      entry.manifests.some(
        (manifest) => manifest.trip.title === "Two-Tank Reef — Molasses & French",
      ),
    );
    const checkpoint = payload?.manifests.find(
      (manifest) => manifest.checkpoint === "after_dive_1",
    );
    const person = checkpoint?.crew.find((member) => !member.rollCall || member.rollCall.implied);
    expect(person?.id, "seeded crew member has no explicit after-dive result").toBeTruthy();
    if (!checkpoint || !person?.id) throw new Error("missing seeded crew checkpoint");
    const tripId = checkpoint.trip.id;
    await page.goto(`/shop/blue-mantis/trips/${tripId}/manifest`, {
      waitUntil: "domcontentloaded",
    });
    await offlineCopySaved(page);
    await openOnThisPhone(page);
    await page.getByRole("link", { name: "Open offline roll call" }).tap();
    await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration("/manifest-sw.js");
          const cache = await caches.open("diveday-offline-manifest-shell-v2");
          return (
            registration?.active?.state === "activated" &&
            Boolean(await cache.match("/offline-manifest"))
          );
        }),
      )
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText("No signal · device copy")).toBeVisible();
    await page.getByRole("button", { name: "After dive 1" }).tap();
    const crew = page
      .locator("#offline-crew-roll-call")
      .getByRole("listitem")
      .filter({ hasText: person.fullName });
    await crew.getByRole("button", { name: "Mark aboard" }).tap();
    await expect(crew.getByRole("button", { name: "Aboard — tap again to undo" })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "when you’re back in service" }),
    ).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "After dive 1" }).tap();
    await expect(crew.getByRole("button", { name: "Aboard — tap again to undo" })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("status").filter({ hasText: "Everything’s sent" })).toBeVisible();
    // An IndexedDB reload alone can pass when the server acknowledges a write
    // it dropped. Read the same person's authoritative checkpoint afresh.
    const response = await request.get("/api/offline-manifests/upcoming");
    expect(response.ok()).toBe(true);
    const authoritative: OfflineManifestUpcomingResponse = await response.json();
    const recorded = authoritative.payloads
      .flatMap((entry) => entry.manifests)
      .find((manifest) => manifest.trip.id === tripId && manifest.checkpoint === "after_dive_1")
      ?.crew.find((member) => member.id === person.id);
    expect(recorded?.fullName).toBe(person.fullName);
    expect(recorded?.rollCall?.state, "server persisted the queued crew result").toBe("boarded");
    expect(recorded?.rollCall?.implied).not.toBe(true);
  });
});
