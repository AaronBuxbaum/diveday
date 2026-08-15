import { strFromU8, unzipSync } from "fflate";
import { expect, READ_ONLY, signedInAs, signedInAsOwner, test } from "./fixtures";

/**
 * The full-shop export flow (ADR 20260722-full-shop-export): the promise that
 * a shop can leave with everything, any time. Happy path downloads and opens
 * the real ZIP; the failure path proves the bundle never leaves without a
 * staff session.
 *
 * READ_ONLY holds here: building the bundle is a pure read of the shop
 * (`loadShopExportBundleInput`, no ledger row for having exported), and the two
 * authorization tests only get refused. The clicks are a disclosure and a download.
 */
test.describe("full-shop data export", () => {
  signedInAsOwner();

  test("staff download the whole shop as documented CSVs", { tag: READ_ONLY }, async ({
    page,
    request,
  }) => {
    await page.goto("/shop/blue-mantis/settings/export");
    await expect(page.getByRole("heading", { name: "Data export" })).toBeVisible();

    // The file list is the page's reference, not its work, so it waits behind
    // a closed disclosure — 44 cards of it used to push Backups off the bottom
    // of the page. Closed, the card still states how many files are in there;
    // opening it is what the promise "one CSV per record type" is read from.
    const bundle = page.getByRole("group").filter({ hasText: "What's in the bundle" });
    await expect(bundle.getByText(/\d+ files, with a row count for each/)).toBeVisible();
    await expect(page.getByText("people.csv")).toBeHidden();
    await bundle.getByText("What's in the bundle").click();
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
      "contacts.csv",
      "people.csv",
      "certifications.csv",
      "trips.csv",
      "trip_requirements.csv",
      "trip_assignments.csv",
      "bookings.csv",
      "waitlist_entries.csv",
      "roll_call_events.csv",
      "waiver_templates.csv",
      "waiver_records.csv",
      "rental_fit.csv",
      "orders.csv",
      "dive_sites.csv",
      "courses.csv",
      // DATA-A10: the families a leaving shop used to lose. Asserted here and
      // not only in the unit coverage test because the failure mode is a file
      // that exists in the loader and never reaches the bytes.
      "booking_checkouts.csv",
      "booking_checkout_bookings.csv",
      "internal_notes.csv",
      "activity_events.csv",
      "notification_deliveries.csv",
      "shop_promo_redemptions.csv",
      "course_inquiries.csv",
    ]) {
      expect(Object.keys(unzipped)).toContain(name);
    }
    expect(strFromU8(unzipped["people.csv"])).toContain("Priya Sharma");
    // The flat import file: one row per person, names pre-split for wizards.
    const contacts = strFromU8(unzipped["contacts.csv"]);
    expect(contacts).toContain("first_name,last_name,full_name");
    expect(contacts).toContain("Priya,Sharma");
    const readme = strFromU8(unzipped["README.txt"]);
    expect(readme).toContain("Not included in this bundle:");
    // Real photo files ride along under photos/ for anything DiveDay's own
    // storage holds (ADR 20260724-export-bundled-photos), not only a URL.
    expect(readme).toContain("photos/");
  });
});

test("the export never leaves without a staff session", { tag: READ_ONLY }, async ({ request }) => {
  const response = await request.get("/shop/blue-mantis/settings/export/download", {
    maxRedirects: 0,
  });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toContain("/sign-in");
});

test.describe("as captain", () => {
  signedInAs("captain");

  test("staff outside owner/manager can't reach export", { tag: READ_ONLY }, async ({
    page,
    request,
  }) => {
    // The bundle carries the whole roster's medical evidence, so a captain —
    // staff everywhere else in the app — has no use for this surface. Bounced
    // to Today with an explanation, not teleported there silently (task 82,
    // UX persona 11 "Kai").
    await page.goto("/shop/blue-mantis/settings/export");
    // Not a URL assertion: FlashParams strips `?notice=export-not-authorized`
    // via history.replaceState shortly after mount — the rendered banner is
    // the stable signal.
    await expect(page).toHaveURL(/\/shop\/blue-mantis(\?.*)?$/);
    await expect(page.getByText("Data export is limited to owners and managers.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download export" })).toHaveCount(0);

    const cookies = await page.context().cookies();
    const response = await request.get("/shop/blue-mantis/settings/export/download", {
      headers: {
        cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
      },
    });
    expect(response.status()).toBe(403);
  });
});
