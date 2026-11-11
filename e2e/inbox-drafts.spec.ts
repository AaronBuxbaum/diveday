import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";

// privateShop owns the sign-in; keep this scope free of the shared owner session.
test("seeded inbox messages can draft a response without replacing their sender flags", async ({
  page,
  request,
  privateShop,
}) => {
  await seedFacts(request, [{ name: "claudeAssists" }], { slug: privateShop.slug });
  await page.goto(`/shop/${privateShop.slug}/inbox`);
  for (const name of ["Priya Sharma", "Diego Alvarez", "Unknown sender"]) {
    await page.getByRole("button", { name: `More for the message from ${name}` }).click();
    await page.getByRole("button", { name: "Draft response", exact: true }).click();
    const response = page.getByRole("textbox", { name: "Response draft" });
    await expect(response).toHaveValue(/Thanks for getting in touch/);
    await response.fill("My own response, reviewed by me.");
    await expect(response).toHaveValue("My own response, reviewed by me.");
    await page.getByRole("button", { name: `More for the message from ${name}` }).click();
  }
});
