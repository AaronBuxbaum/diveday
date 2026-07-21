import { expect, test } from "./fixtures";

test("public marketing pages lead to the product and pricing details", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Run the whole dive day, from booking to head count." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Product" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing" }).first()).toBeVisible();

  await page.getByRole("link", { name: "Product" }).first().click();
  await expect(
    page.getByRole("heading", {
      name: "Everything the shop needs to make a safe departure feel easy.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "A manifest that stays useful after the signal disappears.",
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Pricing" }).first().click();
  await expect(
    page.getByRole("heading", { name: "One shop price. Every operational workflow." }),
  ).toBeVisible();
  await expect(page.getByText("$249", { exact: true })).toBeVisible();
  await expect(page.getByText(/The crew saves the manifest to their phone/)).toBeVisible();
});
