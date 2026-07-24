import { expect, test } from "./fixtures";

test("public marketing pages lead to the product and pricing details", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Run the whole dive day, from booking to head count." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Product" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing" }).first()).toBeVisible();

  // The portability story (safe to leave) is a first-class band on the homepage.
  await expect(
    page.getByRole("heading", { name: "Your data leaves with you — any day, no phone call." }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Product" }).first().click();
  await expect(
    page.getByRole("heading", {
      name: "From the first booking to the last head count.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "A manifest that stays useful after the signal disappears.",
    }),
  ).toBeVisible();
  // The honest-no scope block and the demo CTA both land on the product page.
  await expect(page.getByRole("heading", { name: "What DiveDay doesn't do." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();

  await page.getByRole("link", { name: "Pricing" }).first().click();
  await expect(
    page.getByRole("heading", { name: "One flat price for the whole shop." }),
  ).toBeVisible();
  await expect(page.getByText("$99", { exact: true })).toBeVisible();
  await expect(page.getByText(/The crew saves the manifest to their phone/)).toBeVisible();
  // The objection layer answers the deal-killers, and a skeptic can reach the
  // demo without committing to a trial form.
  await expect(
    page.getByRole("heading", {
      name: "DiveDay is new. What happens to my data if this doesn't work out?",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the live demo first" })).toBeVisible();
});

test("migration guides walk a shop from an incumbent export into the importer", async ({
  page,
}) => {
  // The switch surface is reachable from the footer on any marketing page.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Switch" }).click();

  await expect(page.getByRole("heading", { name: "The door swings both ways." })).toBeVisible();

  // The four named incumbents each have a live guide (no coming-soon entries).
  for (const name of [
    /Switching from EVE/,
    /Switching from DiveShop360/,
    /Switching from DiveAdmin/,
    /Switching from Smartwaiver/,
  ]) {
    await expect(page.getByRole("link", { name })).toBeVisible();
  }

  await page.getByRole("link", { name: /Switching from EVE/ }).click();
  await expect(page.getByRole("heading", { name: "Moving your shop off EVE" })).toBeVisible();

  // The three-part promise: export click-path, the scope table, the importer.
  await expect(page.getByRole("heading", { name: "Get your data out of EVE" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What comes across — and what doesn't" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bring the file into DiveDay" })).toBeVisible();

  // The scope table is the importer's honesty table — medical history never migrates.
  await expect(page.getByText("Medical & health history")).toBeVisible();
  await expect(page.getByText("Never").first()).toBeVisible();

  // Demo-before-trial funnel and cited competitor claims both land on the guide.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(page.getByRole("link", { name: /DiveShop360 acquires EVE Diving/ })).toBeVisible();

  // Another live guide carries its own export path and a competitor-specific note.
  await page.goto("/switching/smartwaiver");
  await expect(
    page.getByRole("heading", { name: "Moving your waivers off Smartwaiver" }),
  ).toBeVisible();
  await expect(page.getByText(/For a Smartwaiver export:/)).toBeVisible();

  // An unlisted incumbent has no page — no coming-soon shells.
  const response = await page.goto("/switching/fareharbor");
  expect(response?.status()).toBe(404);
});
