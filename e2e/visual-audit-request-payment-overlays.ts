import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  openIfClosed,
  openRosterRow,
  openTripFromBoard,
  openTripTab,
  rosterRow,
} from "./helpers";
import type { AuditCapture } from "./visual-audit-capture";

const diverCopy = diverTranslator("en-US");
const staffCopy = staffTranslator("en-US");
const NAMESAKE = "Jordan Alexanderson";

/** Each duplicate is created through the counter's actual confirmation door. */
async function addNamesake(page: Page, shopSlug: string, index: number) {
  await page.goto(`/shop/${shopSlug}/divers/new`);
  await page.getByRole("heading", { level: 1, name: "Add a diver" }).waitFor();
  await page.getByLabel("Full name").fill(NAMESAKE);
  await page.getByLabel("Email").fill(`jordan.review.${index}@example.com`);
  await page.getByRole("button", { name: "Add diver", exact: true }).click();
  if (index > 1) {
    await page.getByRole("heading", { name: /^Is this the same Jordan Alexanderson/ }).waitFor();
    await page.getByRole("button", { name: "Create new diver anyway" }).click();
  }
  await page.waitForURL(new RegExp(`/shop/${shopSlug}/divers/[0-9a-f-]{36}(?:\\?|$)`));
}

export function registerRequestPaymentOverlayAuditCaptures(
  capture: AuditCapture,
  flowTimeout: number,
) {
  test.describe("light mode — held-identity editors", () => {
    test.use({
      colorScheme: "light",
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "reef-review-identity-editors",
    });

    test("a held seat's Different person form renders its age and contact fields", async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/shop/${privateShop.slug}/schedule/board`);
      await openTripFromBoard(page, "Night Dive — City of Washington");
      await openTripTab(page, "Trip");
      await openRosterRow(page, "June Park");
      const row = rosterRow(page, "June Park").first();
      const split = row
        .getByTestId("identity-check")
        .locator('details:has(input[name="fullName"])');
      await openIfClosed(split);
      await expect(split.getByLabel(staffCopy("shared.identityCheck.newNameLabel"))).toHaveValue(
        "Hana Park",
      );
      await capture(page, "held-seat-different-person-editor", "light");
      await split.getByRole("button", { name: staffCopy("shared.identityCheck.split") }).click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: staffCopy("trips.notices.identitySplitAgeUnstated") }),
      ).toBeVisible();
      await openIfClosed(split);
      await capture(page, "held-seat-different-person-age-refusal", "light");
    });

    test("a same-name hold offers unselected alternate records and an intentional radio choice", async ({
      page,
      privateShop,
    }) => {
      // Three real diver writes, trip creation and the held booking are one
      // setup journey; the existing visual flow budget covers those actions.
      test.setTimeout(flowTimeout);
      for (const index of [1, 2, 3]) await addNamesake(page, privateShop.slug, index);
      const title = "Identity review reef morning";
      await createTrip(page, {
        shopSlug: privateShop.slug,
        title,
        date: daysFromNow(6),
        departsAt: "09:00",
        returnsAt: "11:30",
        capacity: 6,
      });
      await page.goto(`/shop/${privateShop.slug}/schedule/board`);
      await openTripFromBoard(page, title);
      await openTripTab(page, "Trip");
      await page
        .locator("#add-diver")
        .getByRole("link", { name: "Add diver", exact: true })
        .click();
      await page.waitForURL(/\/divers\/new/);
      await page.getByLabel("Full name").fill(NAMESAKE);
      await page.getByRole("button", { name: "Add to trip" }).click();
      await page.getByRole("heading", { name: /^Is this the same Jordan Alexanderson/ }).waitFor();
      await page.getByRole("button", { name: NAMESAKE, exact: true }).first().click();
      await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: staffCopy("trips.notices.diverAddedIdentityUnconfirmed") }),
      ).toBeVisible();
      await openRosterRow(page, NAMESAKE);
      const row = rosterRow(page, NAMESAKE).first();
      const choices = row
        .getByTestId("identity-check")
        .locator('details:has(input[name="toPersonId"])');
      await openIfClosed(choices);
      const radios = choices.getByRole("radio", { name: NAMESAKE, exact: true });
      await expect(radios).toHaveCount(2);
      await expect(choices.locator('input[name="toPersonId"]:checked')).toHaveCount(0);
      await capture(page, "held-seat-alternate-records-unselected", "light");
      await radios.first().check();
      await expect(radios.first()).toBeChecked();
      await capture(page, "held-seat-alternate-record-selected", "light");
    });
  });

  test.describe("light mode — code and payment editors", () => {
    test.use({
      colorScheme: "light",
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "reef-review-payment-editors",
    });

    test("the New code composer renders its fields and the disabled-provider refusal", async ({
      page,
      privateShop,
      request,
    }) => {
      expect(
        (await request.post(`/api/test/seed-stripe-account?slug=${privateShop.slug}`)).ok(),
      ).toBe(true);
      await page.goto(`/shop/${privateShop.slug}/promos`);
      const composer = page.locator("#new-code");
      await openIfClosed(composer);
      await composer
        .getByRole("textbox", { name: staffCopy("promos.fields.code"), exact: true })
        .fill("REEFREVIEW15");
      await composer
        .getByRole("spinbutton", { name: staffCopy("promos.fields.discount"), exact: true })
        .fill("15");
      await capture(page, "promo-new-code-composer", "light");
      await composer
        .getByRole("button", { name: staffCopy("promos.createCode"), exact: true })
        .click();
      await page.getByText(staffCopy("promos.notice.stripeFailed"), { exact: true }).waitFor();
      const failed = page
        .locator("li")
        .filter({ hasText: "REEFREVIEW15" })
        .filter({ visible: true });
      await expect(
        failed.getByText(staffCopy("promos.status.failed"), { exact: true }),
      ).toBeVisible();
      await capture(page, "promo-new-code-provider-refusal", "light");
    });

    test("an open non-demo invoice expands the real Charge to room editor", async ({
      page,
      privateShop,
      request,
    }) => {
      expect(
        (await request.post(`/api/test/seed-stripe-account?slug=${privateShop.slug}`)).ok(),
      ).toBe(true);
      const seeded = await request.post("/api/test/seed-payment-overlay", {
        data: { shopSlug: privateShop.slug },
      });
      expect(seeded.ok()).toBe(true);
      const result = await seeded.json();
      if (typeof result.orderId !== "string" || typeof result.cleanupLease !== "string") {
        throw new Error("Payment overlay fixture returned no order or cleanup lease");
      }
      try {
        await page.goto(`/shop/${privateShop.slug}/orders/${result.orderId}`);
        await page.getByRole("heading", { level: 1, name: "Nina Patel" }).waitFor();
        const room = page.locator('details:has(input[name="roomNumber"])');
        await openIfClosed(room);
        await room
          .getByLabel(staffCopy("orders.detail.recordPayment.roomNumber"), { exact: true })
          .fill("214B");
        await room
          .getByLabel(staffCopy("orders.detail.recordPayment.roomHotel"), { exact: true })
          .fill("Harbor House Resort");
        await room
          .getByRole("button", { name: staffCopy("orders.detail.recordPayment.roomConfirm") })
          .waitFor();
        await capture(page, "order-charge-to-room-editor", "light");
      } finally {
        const restored = await request.delete("/api/test/seed-payment-overlay", {
          data: { cleanupLease: result.cleanupLease },
        });
        expect(restored.ok()).toBe(true);
      }
    });
  });

  test.describe("light mode — public date-request outcomes", () => {
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the schedule request renders More details, inline refusal and its sent replacement", async ({
      page,
    }) => {
      await page.goto("/s/blue-mantis");
      const request = page.locator("#request-a-date");
      await openIfClosed(request);
      await request
        .locator("summary")
        .filter({ hasText: diverCopy("inquiry.moreDetails") })
        .click();
      await request.getByLabel(diverCopy("inquiry.alternateDate")).fill("2027-03-13");
      await request.getByLabel(diverCopy("inquiry.whereYouAreUpTo")).selectOption("certified");
      await request
        .getByLabel(diverCopy("inquiry.anythingElse"))
        .fill("Two morning dives, with time to return to the hotel by lunch");
      await capture(page, "date-request-more-details-editor", "light");
      await request.getByRole("button", { name: diverCopy("inquiry.send"), exact: true }).click();
      await request
        .getByText(diverCopy("inquiry.errors.interestRequired"), { exact: true })
        .waitFor();
      await request
        .getByText(diverCopy("inquiry.errors.contactRequired"), { exact: true })
        .waitFor();
      await capture(page, "date-request-inline-refusal", "light");
      await request.getByLabel(diverCopy("inquiry.whatToDive")).fill("Two dives on the Duane");
      await request.getByLabel(diverCopy("inquiry.yourEmail")).fill("wreck.review@example.com");
      await request.getByLabel(diverCopy("inquiry.preferredDate")).fill("2027-03-06");
      await request.getByRole("button", { name: diverCopy("inquiry.send"), exact: true }).click();
      await request.getByText(diverCopy("inquiry.sentHeading"), { exact: true }).waitFor();
      await capture(page, "date-request-sent-replacement", "light");
    });
  });
}
