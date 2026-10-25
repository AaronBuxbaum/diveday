import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * **"Tell us", from anywhere in the staff app** (batch 4, M2): a mail to
 * DiveDay's support address with the shop and the page already filled in, and
 * nothing else about anyone — the page's query string included, since a
 * search or a filter can carry a diver's name.
 */

signedInAsOwner();

test("the identity menu writes to support, naming the shop and the page", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers?q=Priya");
  await page.locator("header [data-identity-menu]").click();
  const tellUs = page.locator("header").getByRole("link", { name: "Send feedback" });
  await expect(tellUs).toBeVisible();

  const href = (await tellUs.getAttribute("href")) ?? "";
  const mail = new URL(href);
  expect(mail.protocol).toBe("mailto:");
  expect(mail.pathname).toBe("support@dive.day");
  expect(mail.searchParams.get("subject")).toBe("DiveDay note from blue-mantis");
  const body = mail.searchParams.get("body") ?? "";
  expect(body).toContain("Page: /shop/blue-mantis/divers");
  expect(body).not.toContain("Priya");
});
