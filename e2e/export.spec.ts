import { strFromU8, unzipSync } from "fflate";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { signInAs } from "./helpers";

/**
 * The full-shop export flow (ADR 20260722-full-shop-export): the promise that
 * a shop can leave with everything, any time. Happy path downloads and opens
 * the real ZIP; the failure path proves the bundle never leaves without a
 * staff session.
 */
test.describe("full-shop data export", () => {
  signedInAsOwner();

  test("staff download the whole shop as documented CSVs", async ({ page, request }) => {
    await page.goto("/shop/blue-mantis/settings/export");
    await expect(page.getByRole("heading", { name: "Data export" })).toBeVisible();
    await expect(page.getByText("people.csv")).toBeVisible();
    await expect(page.getByText("waiver_records.csv")).toBeVisible();

    // The button is a real download, named for the shop and the day.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download export" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^diveday-export-blue-mantis-\d{4}-\d{2}-\d{2}\.zip$/,
    );

    // Open the actual bytes: README manifest plus one CSV per record family,
    // with seeded shop data present and readable.
    const response = await request.get("/shop/blue-mantis/settings/export/download");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/zip");
    const unzipped = unzipSync(new Uint8Array(await response.body()));
    for (const name of [
      "README.txt",
      "shop.csv",
      "people.csv",
      "certifications.csv",
      "trips.csv",
      "trip_requirements.csv",
      "trip_assignments.csv",
      "bookings.csv",
      "roll_call_events.csv",
      "waiver_templates.csv",
      "waiver_records.csv",
      "rental_fit.csv",
    ]) {
      expect(Object.keys(unzipped)).toContain(name);
    }
    expect(strFromU8(unzipped["people.csv"])).toContain("Priya Sharma");
    expect(strFromU8(unzipped["README.txt"])).toContain("Not included in this bundle:");
  });
});

test("the export never leaves without a staff session", async ({ request }) => {
  const response = await request.get("/shop/blue-mantis/settings/export/download", {
    maxRedirects: 0,
  });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toContain("/sign-in");
});

test("staff outside owner/manager are told why they can't export", async ({ page, request }) => {
  // The bundle carries the whole roster's medical evidence, so a captain —
  // staff everywhere else in the app — is refused here, with the reason.
  await signInAs(page, DEV_STAFF_LOGINS.captain);
  await page.goto("/shop/blue-mantis/settings/export");
  await expect(page.getByText(/limited to the shop's owner or manager/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Download export" })).toHaveCount(0);

  const cookies = await page.context().cookies();
  const response = await request.get("/shop/blue-mantis/settings/export/download", {
    headers: {
      cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    },
  });
  expect(response.status()).toBe(403);
});
