import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow } from "./helpers";

signedInAsOwner();

/**
 * Adds a diver through the staff form and returns the record's path. The
 * second record under the same name stops at the "is this the same person?"
 * prompt, and "Create new diver anyway" is the way a duplicate is made at the
 * counter in the first place.
 */
async function addDiver(
  page: Page,
  fields: { name: string; email: string; phone: string },
  duplicate = false,
): Promise<string> {
  await page.goto("/shop/blue-mantis/divers/new");
  await page.getByRole("heading", { level: 1, name: "Add a diver" }).waitFor();
  await page.getByLabel("Full name").fill(fields.name);
  await page.getByLabel("Email").fill(fields.email);
  await page.getByLabel("Phone").fill(fields.phone);
  await page.getByRole("button", { name: "Add diver", exact: true }).click();
  if (duplicate) {
    await page
      .getByRole("heading", { name: new RegExp(`^Is this the same ${fields.name}\\?`) })
      .waitFor();
    await page.getByRole("button", { name: "Create new diver anyway" }).click();
  }
  await page.waitForURL(/\/shop\/blue-mantis\/divers\/[0-9a-f-]{36}(\?|$)/);
  return new URL(page.url()).pathname;
}

/**
 * The merge flow end to end (issue #1240): a duplicate made at the counter
 * under the same name and the same mailbox is offered on its record, the preview lays both records side by side, the
 * staffer keeps the merged-away record's phone, and the merged record's old
 * link lands on the record that was kept.
 */
test("staff merge a duplicate diver into the record they keep, choosing which phone wins", async ({
  page,
}) => {
  const name = `Quorrax Mergeling ${e2eNow().getTime()}`;
  const kept = await addDiver(page, {
    name,
    email: "quorrax.kept@example.com",
    phone: "+1 305 555 0171",
  });
  const duplicate = await addDiver(
    page,
    // One mailbox written two ways: a name alone is never offered as a
    // duplicate, so the counter's record shares the kept record's address.
    { name, email: "quorrax.kept+counter@example.com", phone: "+1 305 555 0172" },
    true,
  );
  expect(duplicate).not.toBe(kept);

  await page.goto(duplicate);
  const panel = page.locator("#merge");
  await expect(panel.getByRole("heading", { name: "Possible duplicate records" })).toBeVisible();
  // The reasons render as one line, strongest first: the shared mailbox, then the name.
  await expect(panel.getByText("Same email · Same name", { exact: true })).toBeVisible();
  await panel.getByRole("link", { name: `Compare with ${name}` }).click();

  await page.getByRole("heading", { level: 1, name: "Merge duplicate records" }).waitFor();
  await expect(page.getByRole("heading", { name: "What moves to the kept record" })).toBeVisible();
  // The two phones disagree, so each is a choice; the kept record's is preselected.
  const keepKept = page.getByRole("radio", { name: /Keep \+1\s305\s555\s0171/ });
  const keepDuplicate = page.getByRole("radio", { name: /Keep \+1\s305\s555\s0172/ });
  await expect(keepKept).toBeChecked();
  await keepDuplicate.check();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Merge into ${name}` }).click();
  await page.waitForURL(
    (url) => url.pathname === kept && url.searchParams.get("notice") === "merged",
  );
  await expect(page.getByText("Diver records merged.", { exact: false })).toBeVisible();

  // The phone the staffer chose is the one the kept record calls.
  const header = page.locator("header").filter({ visible: true }).last();
  await expect(header.locator('a[href^="tel:"]').filter({ visible: true })).toHaveAttribute(
    "href",
    /3055550172/,
  );

  // And the merged record's old link follows its pointer.
  await page.goto(duplicate);
  await page.waitForURL((url) => url.pathname === kept);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("the preview refuses a pair already merged by sending the stale link to the kept record", async ({
  page,
}) => {
  const name = `Quorrax Stalelink ${e2eNow().getTime()}`;
  const kept = await addDiver(page, {
    name,
    email: "stalelink.kept@example.com",
    phone: "+1 305 555 0181",
  });
  const duplicate = await addDiver(
    page,
    { name, email: "stalelink.kept+counter@example.com", phone: "+1 305 555 0182" },
    true,
  );
  const keptId = kept.split("/").pop() ?? "";
  const preview = `${duplicate}/merge/${keptId}`;

  await page.goto(preview);
  await page.getByRole("heading", { level: 1, name: "Merge duplicate records" }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Merge into ${name}` }).click();
  await page.waitForURL((url) => url.pathname === kept);

  // A second tab still holding the preview: it cannot merge twice.
  await page.goto(preview);
  await page.waitForURL((url) => url.pathname === kept);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});
