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
    const bundle = page.getByRole("group").filter({ hasText: "What’s in the bundle" });
    await expect(bundle.getByText(/\d+ files, with a row count for each/)).toBeVisible();
    // `exact` because a file's *note* may name another file: `contacts.csv`'s
    // now ends "people.csv carries the raw stamp and its clearance separately",
    // which is a cross-reference worth having and made the loose locator match
    // two elements. The assertion here is about the bundle listing the file, so
    // it wants the file-name line and not any prose mentioning it.
    await expect(page.getByText("people.csv", { exact: true })).toBeHidden();
    await bundle.getByText("What’s in the bundle").click();
    await expect(page.getByText("people.csv", { exact: true })).toBeVisible();
    await expect(page.getByText("waiver_records.csv", { exact: true })).toBeVisible();

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

/**
 * **The crew sheet a bookkeeper reads** (N-43): one month, one CSV, per crew
 * member the departures they worked, the jobs they did, the hours, and their
 * share of the month's tips.
 *
 * READ_ONLY for the same reason the bundle above it is: generating the sheet
 * is a pure read of the month and writes no ledger row.
 */
test.describe("the crew sheet", () => {
  signedInAsOwner();

  test("downloads one month of crew as a CSV a spreadsheet opens", { tag: READ_ONLY }, async ({
    page,
    request,
  }) => {
    await page.goto("/shop/blue-mantis/settings/export");
    await expect(page.getByRole("heading", { name: "Crew sheet" })).toBeVisible();
    // The one sentence that keeps this from reading as a pay run.
    await expect(
      page.getByText("what anyone is owed is your bookkeeper’s call", { exact: false }),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download crew sheet" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^crew-sheet-blue-mantis-\d{4}-\d{2}\.csv$/);

    // The bytes themselves. The seeded shop rosters its instructor onto this
    // month's course sessions, so the sheet is not just a header row.
    const thisMonth = new Date().toISOString().slice(0, 7);
    const response = await request.get(
      `/shop/blue-mantis/settings/export/crew-sheet?month=${thisMonth}`,
    );
    expect(response.status()).toBe(200);
    // `charset=utf-8` is what keeps an accented crew name out of mojibake.
    expect(response.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    const csv = await response.text();
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Crew member,Role,Departures,Hours,Tips,Currency");
    expect(lines.length).toBeGreaterThan(1);
    expect(csv).toContain("Marcus Webb");
    // Hours and money are plain decimals a spreadsheet sums, and the currency
    // is its own column rather than a symbol glued to the amount.
    for (const line of lines.slice(1)) {
      // Only the first two fields can be quoted, so the last four split cleanly.
      const [departures, hours, tips, currency] = line.split(",").slice(-4);
      expect(departures).toMatch(/^\d+$/);
      expect(hours).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(tips).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(currency).toBe("USD");
    }
  });

  test("refuses a month it cannot parse rather than serving another one", {
    tag: READ_ONLY,
  }, async ({ request }) => {
    for (const month of ["nope", "2026-13", "2026", "../../etc"]) {
      const response = await request.get(
        `/shop/blue-mantis/settings/export/crew-sheet?month=${encodeURIComponent(month)}`,
      );
      expect(response.status()).toBe(400);
    }
  });

  test("returns a header and nothing else for a month nobody worked", { tag: READ_ONLY }, async ({
    request,
  }) => {
    const response = await request.get(
      "/shop/blue-mantis/settings/export/crew-sheet?month=2001-01",
    );
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe("Crew member,Role,Departures,Hours,Tips,Currency\r\n");
  });
});

test("the crew sheet never leaves without a staff session", { tag: READ_ONLY }, async ({
  request,
}) => {
  const response = await request.get("/shop/blue-mantis/settings/export/crew-sheet", {
    maxRedirects: 0,
  });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toContain("/sign-in");
});

/**
 * The per-diver record export (issue #726, ADR 20260824-diver-record-export):
 * a subject-access answer scoped to one diver's own rows, reached from their
 * own record page. Not READ_ONLY — a successful download writes one line to
 * the diver's activity trail — but it needs no private shop either, since
 * that write is scoped to one diver's own booking-shaped rows and resets like
 * any other per-test mutation (AGENTS.md's RESET_KEEPS list is shop-wide
 * settings, not this). The stronger "no other diver's name anywhere in the
 * bundle" property is proven with full control over a shared party and buddy
 * team in src/db/diver-export.test.ts; this proves the real HTTP route and
 * the file-level shape it serves.
 */
test.describe("one diver's own record export", () => {
  signedInAsOwner();

  test("downloads one diver's own record, and only their own", async ({ page, request }) => {
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
    await page.getByRole("link", { name: "Priya Sharma" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download record" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^diveday-diver-export-blue-mantis-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.zip$/,
    );

    const personId = new URL(page.url()).pathname.split("/").at(-1);
    const response = await request.get(`/shop/blue-mantis/divers/${personId}/export`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/zip");
    const unzipped = unzipSync(new Uint8Array(await response.body()));

    // The diver's own record is really in there.
    expect(Object.keys(unzipped)).toContain("profile.csv");
    expect(Object.keys(unzipped)).toContain("bookings.csv");
    expect(strFromU8(unzipped["profile.csv"])).toContain("Priya Sharma");
    const readme = strFromU8(unzipped["README.txt"]);
    expect(readme).toContain("Diver: Priya Sharma");

    // The files the shop-wide bundle carries but a diver's own copy never
    // does — free text that can name a different diver, and a payment
    // session that can cover a whole party (ADR 20260824-diver-record-export).
    for (const excluded of ["internal_notes.csv", "activity_events.csv", "booking_checkouts.csv"]) {
      expect(Object.keys(unzipped)).not.toContain(excluded);
    }
  });
});

test("a diver's own export never leaves without a staff session", { tag: READ_ONLY }, async ({
  request,
}) => {
  const response = await request.get(
    "/shop/blue-mantis/divers/00000000-0000-0000-0000-000000000000/export",
    {
      maxRedirects: 0,
    },
  );
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toContain("/sign-in");
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
    const cookie = cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
    const response = await request.get("/shop/blue-mantis/settings/export/download", {
      headers: { cookie },
    });
    expect(response.status()).toBe(403);

    // The crew sheet carries the roster's names and the month's money, so it
    // sits behind the same owner/manager gate as the bundle — re-read from the
    // database rather than the session's JWT.
    const crewSheet = await request.get("/shop/blue-mantis/settings/export/crew-sheet", {
      headers: { cookie },
    });
    expect(crewSheet.status()).toBe(403);
  });
});
