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
      .filter({ has: page.getByRole("heading", { name: title }) })
      .filter({ visible: true });
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

  test("hiding a rung's course drops it from the public path listing and detail page, without hiding the path", async ({
    page,
  }) => {
    // Advanced Open Water Diver is the second rung on the seeded "From first
    // breath to Rescue Diver" path — hide the course, not the path.
    await page.goto(`/shop/${SHOP}/courses`);
    const row = page.getByRole("listitem").filter({ hasText: "Advanced Open Water Diver" });
    await row.getByRole("button", { name: "Hide Advanced Open Water Diver" }).click();
    await expect(row.getByText("Hidden")).toBeVisible();

    try {
      await page.context().clearCookies();
      await page.goto(PATHS);
      const listing = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("link", { name: "From first breath to Rescue Diver" }) });
      await expect(listing).not.toContainText("Advanced Open Water Diver");
      await expect(listing).toContainText("Discover Scuba Diving");

      await page.goto(`${PATHS}/from-first-breath-to-rescue-diver`);
      const steps = page.getByRole("list");
      await expect(steps.getByRole("link", { name: "Advanced Open Water Diver" })).toHaveCount(0);
      await expect(steps.getByRole("link", { name: "Rescue Diver" })).toBeVisible();
    } finally {
      // Restore it — other specs sharing this database expect the seeded
      // catalog visible by default.
      await signInAs(page, DEV_STAFF_LOGINS.owner);
      await page.goto(`/shop/${SHOP}/courses`);
      const row2 = page.getByRole("listitem").filter({ hasText: "Advanced Open Water Diver" });
      await row2.getByRole("button", { name: "Show Advanced Open Water Diver" }).click();
      await expect(row2.getByText("Hidden")).toHaveCount(0);
    }
  });

  test("a hidden path's own public page 404s for a signed-out visitor, while staff can still open it", async ({
    page,
  }) => {
    const title = `Vault Path ${e2eNow().getTime()}`;
    await page.goto(PATHS);
    await page.getByLabel("Path name").fill(title);
    await page.getByRole("button", { name: "Create path" }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const slug = new URL(page.url()).pathname.split("/").at(-1);

    await page.getByRole("checkbox", { name: "Offer this path to divers" }).uncheck();
    await page.getByRole("button", { name: "Save path" }).click();
    await expect(page.getByRole("status")).toContainText("Path saved.");

    await page.context().clearCookies();
    // Content-level, not `response?.status()`: this route has no
    // `generateStaticParams` coverage (paths are created by shop staff at
    // any time, so no build-time list could ever be exhaustive), and
    // cacheComponents' Partial Prerendering unconditionally serves an
    // optimistic 200 "App Shell" for any dynamic-param combination it
    // doesn't have a static shell for, upgrading it in the background once
    // `notFound()` resolves — there is no per-route opt-out
    // (`dynamicParams = false` and `experimental_ppr` are both removed
    // under `nextConfig.cacheComponents`; confirmed against
    // node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md
    // and cacheComponents.md). The rendered document still correctly lands
    // on Next's own not-found boundary (`<html id="__next_error__">`,
    // `<meta name="robots" content="noindex">`) — nothing about the hidden
    // path leaks — only the raw first-byte HTTP status is 200 instead of
    // 404. Tracked as a known Next 16 cacheComponents limitation to revisit
    // if a future version adds a real per-route PPR opt-out.
    await page.goto(`${PATHS}/${slug}`);
    await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    // And it never shows up in the public index either.
    await page.goto(PATHS);
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);
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
