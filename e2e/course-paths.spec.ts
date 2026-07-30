import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow, signInAs } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";
const PATHS = `/shop/${SHOP}/courses/paths`;

test.describe("certification paths", () => {
  test("staff build a path out of the catalog and divers see it on the course page", async ({
    page,
  }) => {
    const title = `Night Owl Path ${e2eNow().getTime()}`;

    await page.goto(`/shop/${SHOP}/courses`);
    await page.getByRole("link", { name: "Certification paths" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Certification paths" }),
    ).toBeVisible();

    // Create — the builder opens on the new path.
    await page.getByLabel("Path name").fill(title);
    await page.getByLabel("One-line summary").fill("Two nights and a torch.");
    await page.getByRole("button", { name: "Create path" }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("No courses on this path yet")).toBeVisible();

    // Add two rungs, in the wrong order on purpose.
    await page.getByLabel("Add a course").selectOption({ label: "Night Diver · PADI" });
    await page.getByRole("button", { name: "Add to path" }).click();
    await page
      .getByLabel("Add a course")
      .selectOption({ label: "Advanced Open Water Diver · PADI" });
    await page.getByRole("button", { name: "Add to path" }).click();

    const preview = page.getByRole("region", { name: "Path preview" });
    await expect(preview).toContainText("Night Diver → Advanced Open Water Diver");

    // Reorder — Advanced comes first, and the preview follows immediately.
    await page.getByRole("button", { name: "Move Advanced Open Water Diver earlier" }).click();
    await expect(preview).toContainText("Advanced Open Water Diver → Night Diver");

    await page.getByLabel("Step 2 note").fill("Bring your own torch if you have one.");
    await page.getByRole("button", { name: "Save path" }).click();
    await expect(page.getByRole("status")).toContainText("Path saved.");

    // The order and the note survived the round trip.
    await page.reload();
    await expect(page.getByRole("region", { name: "Path preview" })).toContainText(
      "Advanced Open Water Diver → Night Diver",
    );
    await expect(page.getByLabel("Step 2 note")).toHaveValue(
      "Bring your own torch if you have one.",
    );

    // A diver reads the same progression on the public course page.
    await page.context().clearCookies();
    await page.goto(`/shop/${SHOP}/courses/night-diver`);
    const trail = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title }) });
    await expect(trail).toContainText("Two nights and a torch.");
    await expect(trail).toContainText("This is the last step on");
    await expect(trail.getByRole("link", { name: "Advanced Open Water Diver" })).toBeVisible();
  });

  test("a hidden path disappears from the public course page but stays in the catalog", async ({
    page,
  }) => {
    await page.goto(PATHS);
    // The seeded wreck path puts Wreck Diver at the end of a progression.
    await page.goto(`/shop/${SHOP}/courses/wreck-diver`);
    await expect(page.getByRole("heading", { name: "Where this fits" })).toBeVisible();

    await page.goto(PATHS);
    await page
      .getByRole("listitem")
      .filter({ hasText: "Wreck diver" })
      .getByRole("button", { name: /^Hide/ })
      .click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Wreck diver" }).getByText("Hidden"),
    ).toBeVisible();

    await page.goto(`/shop/${SHOP}/courses/wreck-diver`);
    // The other seeded path doesn't contain Wreck Diver, so the section goes.
    await expect(page.getByRole("heading", { name: "Where this fits" })).toHaveCount(0);
  });
});

test.describe("certification paths, as the daily crew", () => {
  // Signs in fresh, so it must start from no session at all — `signedInAsOwner()`
  // above would otherwise bounce /sign-in straight to the shop.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a captain can read the catalog's paths but not shape them", async ({ page }) => {
    // Shaping the catalog is owner/manager/instructor work (H-14).
    await signInAs(page, DEV_STAFF_LOGINS.captain);
    await page.goto(PATHS);
    await expect(
      page.getByRole("heading", { level: 1, name: "Certification paths" }),
    ).toBeVisible();
    await expect(page.getByText("limited to owners, managers, and instructors")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create path" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  });
});
