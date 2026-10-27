import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * **A shop without Claude has lost nothing** (ADR 20261018-claude-assists).
 * The browser suite runs with `DIVEDAY_DISABLE_EXTERNAL_HTTP=1` against the
 * demo shop, and both make every assist dark, so each surface the
 * front-of-house assists touch must render exactly its own controls: no Draft,
 * no Translate, no Make a request, no call scribble, no column mapping, no
 * Website tab and no PDF draft. The lit surfaces are covered by their
 * component and action tests with the fake provider.
 */
test.describe("the front-of-house assists, dark", () => {
  signedInAsOwner();

  test("the inbox, the call form, the importer and the waiver editor carry no assist", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/inbox");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Draft a booking request/ })).toHaveCount(0);
    await expect(page.getByText("Urgent", { exact: true })).toHaveCount(0);

    await page.goto("/shop/blue-mantis/bookings/new#call");
    await expect(page.getByLabel("Notes from the call")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Fill the form" })).toHaveCount(0);

    await page.goto("/shop/blue-mantis/settings/import");
    await expect(page.getByRole("link", { name: "Website", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Map the other columns" })).toHaveCount(0);
    // Asked for by URL, the Website tab is the Divers tab while dark.
    await page.goto("/shop/blue-mantis/settings/import?what=website");
    await expect(page.getByRole("heading", { name: "Set up from your website" })).toHaveCount(0);

    await page.goto("/shop/blue-mantis/waivers#release");
    await expect(page.getByRole("button", { name: "Draft from PDF" })).toHaveCount(0);
  });
});
