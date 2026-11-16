import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import {
  OFFLINE_MANIFEST_SHELL_VERSION,
  type OfflineManifestUpcomingResponse,
} from "../src/lib/offline-manifests";
import { ROLL_CALL_CAUSAL_HEADERS } from "../src/lib/roll-call-protocol";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  offlineCopySaved,
  openDeckDetails,
  openDeckPerson,
  openOnThisPhone,
  openThreadStep,
} from "./helpers";

const diver = diverTranslator("en-US");
const staff = staffTranslator("en-US");
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

test.describe("staff navigation on a phone", () => {
  signedInAsOwner();

  test("More remains open and its destination receives a tap after the animation", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis");
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    const more = nav.getByRole("button", { name: "More", exact: true });
    const money = nav.getByRole("link", { name: "Money", exact: true });

    await more.tap();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(money).toBeVisible();
    await money.locator("../..").evaluate(async (panel) => {
      await Promise.all(panel.getAnimations().map((animation) => animation.finished));
    });
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(money).toBeVisible();
    expect(
      await money.evaluate((link) => {
        const rect = link.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit !== null && link.contains(hit);
      }),
      "the destination is hit-testable at its center",
    ).toBe(true);
    await money.tap();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(more).toHaveAttribute("aria-expanded", "false");
  });

  test("More's panel is painted and stays open for two seconds", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    const more = nav.getByRole("button", { name: "More", exact: true });
    const panel = nav.getByRole("link", { name: "Money", exact: true }).locator("../..");
    await expect(nav).toHaveAttribute("data-hydrated", "true");

    await more.tap();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    // diveday:allow-e2e-hygiene sleep: the bug is the panel vanishing seconds after opening; only elapsed time can show it
    await page.waitForTimeout(2000);
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const box = await panel.boundingBox();
    expect(box, "the panel has a box").not.toBeNull();
    if (!box) return;
    const viewport = page.viewportSize();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport?.width ?? 0);
    const open = await page.screenshot({ clip: box });

    await more.tap();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveCount(0);
    const closed = await page.screenshot({ clip: box });
    // Painted pixels, not DOM visibility: the open panel must differ from the
    // page behind it, or the menu is in the tree but not on the glass.
    expect(open.equals(closed), "the open panel paints over the page").toBe(false);
  });
});

test("touch booking and guardian signing stay complete after reload", async ({ page }) => {
  await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
  const trip = page
    .getByRole("list", { name: "Upcoming trips" })
    .getByRole("link", { name: /(?:[0-9]+ seats?|last seat)/i })
    .first();
  await expect(trip).toBeVisible();
  await trip.tap();
  await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}$/);
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
  await expect.poll(() => new URL(page.url()).pathname).toBe(readyPath);
  await page.goto(readyPath, { waitUntil: "domcontentloaded" });
  await expect(
    page.locator("li[data-thread-step='sign']").filter({ visible: true }),
  ).toHaveAttribute("data-step-state", "done");
});

test("a referred signer sees the physician step before returning to their booking", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
  const trip = page
    .getByRole("list", { name: "Upcoming trips" })
    .getByRole("link", { name: /(?:[0-9]+ seats?|last seat)/i })
    .first();
  await expect(trip).toBeVisible();
  await trip.tap();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Mobile Referral");
  await page.getByLabel("Email", { exact: true }).fill("mobile-referral@example.com");
  await page.getByRole("button", { name: /^Book/ }).tap();
  await expect(page).toHaveURL(/\/ready\//);
  const readyPath = new URL(page.url()).pathname;
  const sign = await openThreadStep(page, "sign");
  await sign.getByRole("button", { name: "Sign your waiver" }).tap();
  await page.getByLabel("Type your full name").fill("Mobile Referral");
  await page.getByLabel(diver("waiver.agreementCheckbox")).tap();
  const answers = page.getByRole("radio", { name: "No", exact: true });
  await expect(answers).not.toHaveCount(0);
  for (const answer of await answers.all()) await answer.tap();
  await page
    .locator("#medical-questionnaire fieldset")
    .filter({ visible: true })
    .nth(2)
    .getByRole("radio", { name: "Yes", exact: true })
    .tap();
  await page.getByRole("button", { name: "Sign waiver", exact: true }).tap();
  await expect(page.getByText(diver("waiver.medicalReferralNext"))).toBeVisible();
  await expect(page.getByRole("link", { name: diver("waiver.doctor.open") })).toBeVisible();
  await page.getByRole("link", { name: diver("waiver.seeWhatsLeft") }).tap();
  await expect.poll(() => new URL(page.url()).pathname).toBe(readyPath);
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
    const seed = await request.get("/api/offline-manifests/upcoming", {
      headers: ROLL_CALL_CAUSAL_HEADERS,
    });
    expect(seed.status(), await seed.text()).toBe(200);
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
    await openDeckDetails(page);
    await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async (version) => {
          const registration = await navigator.serviceWorker.getRegistration("/manifest-sw.js");
          const base = `diveday-offline-manifest-shell-${version}`;
          // Production names the cache by build too (`-<build id>`).
          const name = (await caches.keys()).find((k) => k === base || k.startsWith(`${base}-`));
          const cache = name ? await caches.open(name) : null;
          return (
            registration?.active?.state === "activated" &&
            cache !== null &&
            Boolean(await cache.match("/offline-manifest"))
          );
        }, OFFLINE_MANIFEST_SHELL_VERSION),
      )
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await openDeckDetails(page);
    await expect(page.getByText("No signal · device copy")).toBeVisible();
    await page.getByRole("button", { name: "After dive 1" }).tap();
    await openDeckPerson(page, person.fullName);
    await page
      .getByRole("button", {
        name: staff("manifest.deck.record", { name: person.fullName }),
        exact: true,
      })
      .tap();
    const receipt = page.locator('[data-deck-screen="receipt"]');
    await expect(
      receipt.getByRole("heading", { name: person.fullName, exact: true }),
    ).toBeVisible();
    await expect(receipt).toContainText(staff("manifest.deck.savedAboard"));
    await expect(
      receipt.getByText(staff("manifest.deck.pendingReceipt"), { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("status")
        .getByText(staff("shared.offlineManifest.reconcile.pendingWaiting", { count: 1 }), {
          exact: true,
        }),
    ).toBeVisible();
    await openDeckPerson(page, person.fullName);
    await expect(page.locator('[data-deck-screen="person"]')).toContainText(
      staff("manifest.deck.pendingReceipt"),
    );
    await page.getByRole("button", { name: staff("manifest.deck.exception"), exact: true }).tap();
    const crew = page
      .locator("#offline-crew-roll-call")
      .getByRole("listitem")
      .filter({ hasText: person.fullName });
    await expect(crew.getByRole("button", { name: "Aboard — tap again to undo" })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await openDeckDetails(page);
    await page.getByRole("button", { name: "After dive 1" }).tap();
    await openDeckPerson(page, person.fullName);
    await expect(page.locator('[data-deck-screen="person"]')).toContainText(
      staff("manifest.deck.pendingReceipt"),
    );
    await expect(
      page
        .getByRole("status")
        .getByText(staff("shared.offlineManifest.reconcile.pendingWaiting", { count: 1 }), {
          exact: true,
        }),
    ).toBeVisible();
    await page.getByRole("button", { name: staff("manifest.deck.exception"), exact: true }).tap();
    await expect(crew.getByRole("button", { name: "Aboard — tap again to undo" })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("status").filter({ hasText: "Everything’s sent" })).toBeVisible();
    // An IndexedDB reload alone can pass when the server acknowledges a write
    // it dropped. Read the same person's authoritative checkpoint afresh.
    const response = await request.get("/api/offline-manifests/upcoming", {
      headers: ROLL_CALL_CAUSAL_HEADERS,
    });
    expect(response.status(), await response.text()).toBe(200);
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
