import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { signedInAsOwner, test } from "./fixtures";
import { e2eNow, signInAs } from "./helpers";

/**
 * The full-shop data export — the portability wedge's "leave anytime"
 * guarantee. The happy path proves the one-button bundle really contains the
 * shop's data; the failure paths prove the bundle (diver PII + medical
 * evidence) is sealed to owner/manager, in the UI and at the route itself.
 */

test.describe("full-shop data export", () => {
  test.describe("as the owner", () => {
    signedInAsOwner();

    test("downloads the complete documented bundle", async ({ page }) => {
      await page.goto("/shop/blue-mantis/settings/export");
      await expect(page.getByRole("heading", { level: 1, name: "Export your data" })).toBeVisible();
      // The page states the promise and documents the bundle before the button.
      await expect(page.getByText("Your data is yours")).toBeVisible();
      await expect(page.getByText("people.csv", { exact: true })).toBeVisible();
      await expect(page.getByText("roll-call-events.csv", { exact: true })).toBeVisible();

      const downloadEvent = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download everything" }).click();
      const download = await downloadEvent;

      const frozenDate = e2eNow().toISOString().slice(0, 10);
      expect(download.suggestedFilename()).toBe(`diveday-export-blue-mantis-${frozenDate}.zip`);

      const zipPath = await download.path();
      const files = unzipSync(new Uint8Array(await readFile(zipPath)));
      const names = Object.keys(files);
      expect(names).toContain("README.md");
      expect(names).toContain("people.csv");
      expect(names).toContain("waiver-records.csv");
      expect(names).toContain("trips.csv");
      expect(names).toContain("booking-payments.csv");
      expect(names).toContain("roll-call-events.csv");

      // The bundle holds the shop's real data, not just headers: a seeded
      // diver in people.csv, and a README that documents every file.
      const peopleCsv = strFromU8(files["people.csv"]);
      expect(peopleCsv).toContain("Priya Sharma");
      const readme = strFromU8(files["README.md"]);
      for (const name of names.filter((entry) => entry !== "README.md")) {
        expect(readme).toContain(`## ${name}`);
      }
      // Signing-link secrets never leave, by construction.
      expect(strFromU8(files["waiver-records.csv"])).not.toContain("token_hash");
    });
  });

  test("refuses the bundle to staff who are not owner or manager", async ({ page }) => {
    await signInAs(page, DEV_STAFF_LOGINS.instructor);

    await page.goto("/shop/blue-mantis/settings/export");
    // The page explains instead of dangling a button that would 403.
    await expect(page.getByText("only an owner or manager can download it")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download everything" })).toHaveCount(0);

    // The route itself fails closed too — the button's absence is not the gate.
    const response = await page.request.get("/shop/blue-mantis/settings/export/download");
    expect(response.status()).toBe(403);
  });

  test("requires a signed-in staff session at the route", async ({ request }) => {
    // The edge proxy bounces a signed-out request to /sign-in before the
    // route's own 401 (its inner layer, ADR-0006) is ever reached.
    const response = await request.get("/shop/blue-mantis/settings/export/download", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/sign-in");
  });
});
