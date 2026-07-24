import type { Page } from "@playwright/test";
import sharp from "sharp";
import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow } from "./helpers";

signedInAsOwner();

/** The diver detail page has two capture forms; scope by the form's own submit button. */
function levelForm(page: Page) {
  return page.locator("form", {
    has: page.getByRole("button", { name: "Capture for review", exact: true }),
  });
}
function specialtyForm(page: Page) {
  return page.locator("form", {
    has: page.getByRole("button", { name: "Capture specialty for review" }),
  });
}

test("staff captures and verifies level and specialty cards before either can be trusted", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();

  // Level card: capture lands as pending, only an explicit verify trusts it.
  await page.getByText("Add card", { exact: true }).click(); // open the collapsed capture form
  const form = levelForm(page);
  await expect(form.locator('input[name="cardImageUrl"]')).toHaveCount(0);
  await expect(form.locator('input[name="cardImage"]')).toBeVisible();
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="level"]').selectOption("advanced_open_water");
  await form.getByLabel("Card number").fill(`PADI-AOW-${e2eNow().getTime()}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("pending");

  const pendingRow = page.locator("li").filter({ hasText: "pending" }).last();
  await pendingRow.getByRole("button", { name: "Mark certified" }).click();
  await expect(page.getByRole("status")).toContainText("certified");

  // Specialty card: gated exactly the same way, on the same record.
  await page.getByText("Add specialty", { exact: true }).click(); // open the collapsed capture form
  const cardNo = `PADI-WRECK-${e2eNow().getTime()}`;
  const specialty = specialtyForm(page);
  await specialty.locator('select[name="agency"]').selectOption("padi");
  await specialty.locator('select[name="specialty"]').selectOption("wreck");
  await specialty.getByLabel("Card number").fill(cardNo);
  await specialty.getByRole("button", { name: "Capture specialty for review" }).click();
  await expect(page.getByRole("status")).toContainText("pending");

  // Scope to this card's row by its unique number; the specialty card shows
  // "<agency> · <specialty>", not the literal word "specialty".
  const specialtyRow = page.locator("li").filter({ hasText: cardNo }).last();
  await specialtyRow.getByRole("button", { name: "Mark certified" }).click();
  await expect(page.getByRole("status")).toContainText("certified");

  // The specialty card can be deleted outright (replaces the old "needs
  // correction" flow). No confirm dialog: the delete lands and a toast offers a
  // one-tap undo (delight backlog — land-then-undo over "are you sure?").
  await page
    .locator("li")
    .filter({ hasText: cardNo })
    .last()
    .getByRole("button", {
      name: "Delete",
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Card removed");
  await expect(page.locator("li").filter({ hasText: cardNo })).toHaveCount(0);
});

test("an oversize card photo is rejected client-side before it ever reaches the server (CR-011)", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();
  await page.getByText("Add card", { exact: true }).click();
  const form = levelForm(page);

  await form.locator('input[name="cardImage"]').setInputFiles({
    name: "card.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(6 * 1024 * 1024), // over the 5 MB card-photo limit
  });
  await expect(form.getByRole("alert")).toContainText("over 5 MB");
  // Rejected client-side: the picker itself is cleared, not just annotated —
  // a submit right after cannot silently carry the oversize file.
  await expect(form.locator('input[name="cardImage"]')).toHaveValue("");
});

test("a real photo passes the server's decode/re-encode pipeline end to end (CR-012)", async ({
  page,
}) => {
  const jpeg = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 20, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();

  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();
  await page.getByText("Add card", { exact: true }).click();
  const form = levelForm(page);
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="level"]').selectOption("advanced_open_water");
  await form.getByLabel("Card number").fill(`PADI-PIPELINE-${e2eNow().getTime()}`);
  await form
    .locator('input[name="cardImage"]')
    .setInputFiles({ name: "card.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  // The e2e fleet has no BLOB_READ_WRITE_TOKEN configured, so a genuinely
  // decodable photo still lands as "captured, no photo stored" — the point is
  // it reaches that notice at all, proving the server accepted (didn't
  // reject as malformed) real image bytes it just decoded and re-encoded.
  await expect(page.getByRole("status")).toContainText("pending");
});

test("a disguised file is rejected by the server even though it claims an allowed type (CR-012)", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();
  await page.getByText("Add card", { exact: true }).click();
  const form = levelForm(page);
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="level"]').selectOption("advanced_open_water");
  await form.getByLabel("Card number").fill(`PADI-DISGUISED-${e2eNow().getTime()}`);
  await form.locator('input[name="cardImage"]').setInputFiles({
    name: "card.jpg",
    mimeType: "image/jpeg", // claims to be a JPEG — only the real decode below catches it
    buffer: Buffer.from("not actually a jpeg, just text pretending to be one".repeat(20)),
  });
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "That photo could not be used. Upload a JPG, PNG, or WebP under 5 MB.",
  );
});

test("an expired certification reads as expired and no longer counts as valid", async ({
  page,
}) => {
  // Yusuf Demir carries a verified card that lapsed weeks ago (see the seed).
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("link", { name: /Yusuf Demir/ }).click();
  await page.getByRole("heading", { level: 1, name: "Yusuf Demir" }).waitFor();

  const expiredRow = page.locator("li").filter({ hasText: "expired" }).first();
  await expect(expiredRow).toBeVisible();
  // It reads as "expired", never "certified".
  await expect(expiredRow).not.toContainText("certified");
});
