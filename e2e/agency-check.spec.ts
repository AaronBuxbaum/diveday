import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openDiverFileGroup, openSettingsRow } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";

/**
 * **"Check with SSI", done by the DiveDay browser extension** (H-105).
 *
 * The installed extension is `agency-check-extension.spec.ts`'s; this covers
 * the app's side of each answer, and the agencies' pages are not ours to
 * hit from a test. So this stands in for it at the one seam the app sees: the
 * marker on `<html>` and the `postMessage` request and reply
 * (`src/lib/cert-check-extension.ts`). The reply is the text an agency's page
 * might show; the verdict, the write and the Undo are the real ones.
 */
async function installFakeExtension(page: Page, answer: "match" | "captcha", version = "1.5.0") {
  await page.addInitScript(
    ([mode, announced]) => {
      const announce = () => {
        document.documentElement.setAttribute("data-diveday-cert-check", announced);
        window.dispatchEvent(new Event("diveday-cert-check-ready"));
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", announce);
      } else {
        announce();
      }
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (data?.source !== "diveday-page" || data.type !== "agency-check") return;
        const name = `${data.query.firstName} ${data.query.lastName}`;
        window.postMessage(
          {
            source: "diveday-cert-check",
            type: "agency-check-result",
            requestId: data.requestId,
            ok: true,
            pageText:
              mode === "match"
                ? `Online Diver Check\n${name}\nCard ${data.query.cardNumber}\nOpen Water Diver`
                : "Please confirm you are human",
          },
          window.location.origin,
        );
      });
    },
    [answer, version] as const,
  );
}

async function diverWithPendingSsiCard(page: Page, offersCheck = true) {
  const stamp = Date.now();
  await page.goto(`/shop/${SHOP}/divers/new`);
  await page.getByLabel("Full name").fill(`Agency ${stamp} Checker`);
  await page.getByLabel("Email").fill(`agency-check-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add diver" }).click();
  await page.waitForURL(new RegExp(`/shop/${SHOP}/divers/[0-9a-f-]{36}`));
  const group = await openDiverFileGroup(page, "Certification records");
  await group.getByText("Add certification", { exact: true }).click();
  const form = page
    .locator("form", { has: page.getByRole("button", { name: "Capture for review", exact: true }) })
    .filter({ visible: true });
  await form.locator('select[name="agency"]').selectOption("ssi");
  await form.locator('select[name="card"]').selectOption("level:open_water");
  await form.getByLabel("Certification number").fill(`SSI-${stamp}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  const cards = await openDiverFileGroup(page, "Certification records");
  await expect(cards.getByRole("button", { name: "Mark certified" })).toBeVisible();
  if (offersCheck)
    await expect(cards.getByRole("button", { name: "Check with SSI" })).toBeVisible();
  return cards;
}

test("a match on the agency's page certifies the card, and Undo puts it back", async ({ page }) => {
  test.setTimeout(45_000);
  await installFakeExtension(page, "match");
  const group = await diverWithPendingSsiCard(page);

  await group.getByRole("button", { name: "Check with SSI" }).click();

  const toast = page
    .getByRole("status")
    .filter({ hasText: "SSI shows this certification. Marked certified." });
  await expect(toast).toBeVisible();
  await expect(group.getByText(/^Checked with SSI by /)).toBeVisible();
  await expect(group.getByText(/Open Water Diver$/)).toBeVisible();

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(group.getByRole("button", { name: "Check with SSI" })).toBeVisible();
  await expect(group.getByText(/^Checked with SSI by /)).toHaveCount(0);
});

test("a page that does not read as a result writes nothing and offers the link", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await installFakeExtension(page, "captcha");
  const group = await diverWithPendingSsiCard(page);

  await group.getByRole("button", { name: "Check with SSI" }).click();

  await expect(
    group.getByText(/^Couldn’t find .+ on SSI’s page\. Open it and look\.$/),
  ).toBeVisible();
  await expect(group.getByRole("link", { name: "Check with SSI" })).toHaveAttribute(
    "href",
    "https://my.divessi.com/online_diver_check",
  );
  await expect(group.getByRole("button", { name: "Mark certified" })).toBeVisible();
});

test("a copy of the extension older than DiveDay needs is told to update, and checks fall back to the link", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await installFakeExtension(page, "match", "1.4.0");
  await page.goto(`/shop/${SHOP}/settings`);
  await openSettingsRow(page, "Card checks");
  const row = page
    .locator("details")
    .filter({ has: page.getByRole("heading", { name: "Card checks", exact: true }) });
  await expect(
    row.getByText("Update the extension: this browser has 1.4.0, DiveDay needs 1.5.0."),
  ).toBeVisible();

  const group = await diverWithPendingSsiCard(page, false);
  await expect(group.getByRole("link", { name: "Check with SSI" })).toHaveAttribute(
    "href",
    "https://my.divessi.com/online_diver_check",
  );
  await expect(group.getByRole("button", { name: "Check with SSI" })).toHaveCount(0);
});
