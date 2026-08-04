import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

const BACKUP_SETTINGS = "/shop/blue-mantis/settings/backup";

/**
 * The shop-owned backup settings surface (docs ADR
 * 20260804-shop-owned-backup-export): destination form, on-demand test
 * delivery, and the delivery history.
 *
 * The seed ships blue-mantis already configured with six weekly deliveries
 * (one failed) and a manual proof run, so the read-only assertions run against
 * that. The mutating tests save their own destination first — each Playwright
 * worker owns an isolated database, and `fullyParallel` means no test may
 * depend on another's writes. The destination endpoint used here is a
 * reserved-TLD host that can never resolve, so a triggered delivery fails
 * fast with a *recorded* failure row — which is exactly the failure-path
 * behavior under test; the upload happy path is pinned by unit tests against
 * an injected fetch (src/features/backup-export/run-backup.test.ts), since
 * the fleet blocks external HTTP on purpose.
 */

const DESTINATION = {
  endpoint: "https://backups.blue-mantis-e2e.example",
  region: "auto",
  bucket: "blue-mantis-owned-bucket",
  prefix: "diveday",
  accessKeyId: "AKIA-E2E-BACKUP",
  secret: "e2e-secret-access-key-value",
};

async function saveDestination(page: import("@playwright/test").Page) {
  await page.goto(BACKUP_SETTINGS);
  await page.getByRole("textbox", { name: "Endpoint" }).fill(DESTINATION.endpoint);
  await page.getByRole("textbox", { name: "Region" }).fill(DESTINATION.region);
  await page.getByRole("textbox", { name: "Bucket", exact: true }).fill(DESTINATION.bucket);
  await page.getByRole("textbox", { name: "Folder prefix" }).fill(DESTINATION.prefix);
  await page.getByRole("textbox", { name: "Access key ID" }).fill(DESTINATION.accessKeyId);
  await page.getByLabel("Secret access key").fill(DESTINATION.secret);
  await page.getByRole("button", { name: "Save destination" }).click();
  await expect(page.getByText("Backup destination saved.")).toBeVisible();
}

test.describe("backup settings", () => {
  signedInAsOwner();

  test("shows the seeded destination and its delivery history, failures named", async ({
    page,
  }) => {
    await page.goto(BACKUP_SETTINGS);

    await expect(page.getByRole("heading", { name: "Backups are set up" })).toBeVisible();
    await expect(page.getByText("https://backups.blue-mantis.example")).toBeVisible();
    await expect(page.getByText("BMKEYIDDEMO0001")).toBeVisible();

    // The history table: successes with their object keys and sizes, and the
    // seeded bad week named by reason, not swallowed.
    await expect(page.getByRole("heading", { name: "Delivery history" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Delivered" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Failed" })).toBeVisible();
    await expect(
      page.getByText("The bucket refused the credential — check the access key"),
    ).toBeVisible();
  });

  test("saving a destination never echoes the secret back", async ({ page }) => {
    await saveDestination(page);

    // The form is back, pointed at the new destination — with the secret
    // field empty and the plaintext nowhere in the served document.
    await expect(page.getByRole("textbox", { name: "Bucket", exact: true })).toHaveValue(
      DESTINATION.bucket,
    );
    await expect(page.getByLabel("Secret access key")).toHaveValue("");
    expect(await page.content()).not.toContain(DESTINATION.secret);
    await expect(
      page.getByText("Leave blank to keep the current key", { exact: false }),
    ).toBeVisible();

    // A new credential is unproven until a delivery lands.
    await expect(page.getByText("Not proven yet")).toBeVisible();
  });

  test("a test delivery that cannot reach the bucket becomes a recorded failure row", async ({
    page,
  }) => {
    await saveDestination(page);

    await page.getByRole("button", { name: "Run a test delivery now" }).click();

    // The action ran a real delivery attempt: refused by DNS, recorded, and
    // explained — never a crash, never a silent success.
    await expect(
      page.getByText("The test delivery didn't land. The endpoint couldn't be reached."),
    ).toBeVisible();
    const historyRow = page.getByRole("row").filter({ hasText: "Test" }).first();
    await expect(historyRow.getByRole("cell", { name: "Failed" })).toBeVisible();
    await expect(historyRow.getByText("The endpoint couldn't be reached.")).toBeVisible();
  });

  test("leaving the secret blank keeps the stored credential instead of erasing it", async ({
    page,
  }) => {
    await saveDestination(page);

    // Re-save with a changed bucket and no secret.
    await page.getByRole("textbox", { name: "Bucket", exact: true }).fill("renamed-bucket");
    await page.getByRole("button", { name: "Save destination" }).click();
    await expect(page.getByText("Backup destination saved.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Bucket", exact: true })).toHaveValue(
      "renamed-bucket",
    );

    // A test run still gets far enough to attempt the upload — meaning the
    // stored secret opened fine. (An erased credential would report the
    // stored key as unreadable instead.)
    await page.getByRole("button", { name: "Run a test delivery now" }).click();
    await expect(
      page.getByText("The test delivery didn't land. The endpoint couldn't be reached."),
    ).toBeVisible();
  });

  test("refuses a destination pointing at a private address, with the reason", async ({ page }) => {
    await page.goto(BACKUP_SETTINGS);
    await page.getByRole("textbox", { name: "Endpoint" }).fill("https://169.254.169.254");
    await page.getByRole("textbox", { name: "Region" }).fill("auto");
    await page.getByRole("textbox", { name: "Bucket", exact: true }).fill("bucket");
    await page.getByRole("textbox", { name: "Access key ID" }).fill("AKIA");
    await page.getByLabel("Secret access key").fill("secret");
    await page.getByRole("button", { name: "Save destination" }).click();

    await expect(
      page.getByText("That endpoint points at a private or local address", { exact: false }),
    ).toBeVisible();
  });
});

test.describe("backup settings authorization", () => {
  // A captain runs the boat but does not hold the shop's data hostage-proofing.
  signedInAs("captain");

  test("a captain is bounced with an explanation, not a blank page", async ({ page }) => {
    await page.goto(BACKUP_SETTINGS);

    await expect(
      page.getByText("Only an owner or manager can change backup settings."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Delivery history" })).toHaveCount(0);
  });

  test("and is not offered the door from the settings index", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings");

    await expect(page.getByRole("link", { name: "Set up backups" })).toHaveCount(0);
  });
});
