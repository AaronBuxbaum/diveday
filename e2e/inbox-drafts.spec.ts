import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";

// privateShop owns the sign-in; keep this scope free of the shared owner session.
test("seeded inbox messages can draft a response without replacing their sender flags", async ({
  page,
  request,
  privateShop,
}) => {
  await seedFacts(request, [{ name: "claudeAssists" }], { slug: privateShop.slug });
  for (const name of ["Priya Sharma", "Diego Alvarez"]) {
    await page.goto(`/shop/${privateShop.slug}/inbox`);
    const menu = page.getByRole("button", { name: `More for the message from ${name}` });
    await menu.click();
    await expect(page.getByRole("button", { name: "Draft response", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(/\/divers\/[0-9a-f-]{36}/);
    const conversation = page.getByRole("region", { name: "Conversation" });
    await conversation.getByRole("button", { name: "Draft with AI" }).click();
    const response = conversation.locator("textarea").first();
    await expect(response).toHaveValue(/Thanks for getting in touch/);
    await response.fill("My own response, reviewed by me.");
    await expect(response).toHaveValue("My own response, reviewed by me.");
  }
  await page.goto(`/shop/${privateShop.slug}/inbox`);
  await page.getByRole("button", { name: "More for the message from Unknown sender" }).click();
  await expect(page.getByRole("button", { name: "Draft response", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reply by email" })).toBeVisible();
});
