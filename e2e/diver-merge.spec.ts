import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow } from "./helpers";

signedInAsOwner();

const staff = staffTranslator("en-US");

for (const activation of ["pointer", "keyboard"] as const) {
  test(`staff reach the sixth duplicate candidate by ${activation} before comparing records`, async ({
    page,
    request,
  }) => {
    const seeded = await request.post("/api/test/seed-trouble-states?mergeCandidates=1");
    expect(seeded.ok()).toBe(true);
    const { mergeCandidates } = (await seeded.json()) as {
      mergeCandidates: { sourceId: string; candidateIds: string[] };
    };
    expect(mergeCandidates.candidateIds).toHaveLength(8);
    await page.goto(`/shop/blue-mantis/divers/${mergeCandidates.sourceId}`);
    const panel = page.locator("#merge");
    const compare = panel.getByRole("link", { name: /Compare with/ });
    const showMore = panel.getByRole("button", { name: staff("divers.merge.showMore") });
    const sixth = panel.getByRole("link", {
      name: staff("divers.merge.compareWith", { name: "Mara Duplicate 06" }),
    });
    await expect(compare).toHaveCount(5);
    await expect(sixth).toHaveCount(0);
    if (activation === "keyboard") {
      await compare.last().focus();
      await page.keyboard.press("Tab");
      await expect(showMore).toBeFocused();
      await page.keyboard.press("Enter");
    } else {
      await showMore.click();
    }
    await expect(compare).toHaveCount(8);
    await expect(sixth).toBeFocused();
    await expect(panel.getByText(staff("divers.merge.samePhone"), { exact: true })).toHaveCount(8);
    await expect(showMore).toHaveCount(0);
    await expect(panel.getByRole("checkbox")).toHaveCount(0);
    const preview = `/shop/blue-mantis/divers/${mergeCandidates.sourceId}/merge/${mergeCandidates.candidateIds[5]}`;
    await expect(sixth).toHaveAttribute("href", preview);
    if (activation === "keyboard") await page.keyboard.press("Enter");
    else await sixth.click();
    await page.waitForURL((url) => url.pathname === preview);
    await expect(
      page.getByRole("heading", { level: 1, name: staff("divers.mergePreview.title") }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: staff("divers.mergePreview.submit", { name: "Mara Duplicate 06" }),
      }),
    ).toBeVisible();
  });
}

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
 * under the same name and the same phone is offered on its record, the
 * preview lays both records side by side, the staffer keeps the merged-away
 * record's email, and the merged record's old link lands on the record that
 * was kept. A plus-tagged address is never "Same email" (a family booked as
 * parent+kid@ is several people), so the shared detail here is the phone.
 */
test("staff merge a duplicate diver into the record they keep, choosing which email wins", async ({
  page,
}) => {
  // Sized for sequential multi-record setup: creates two separate diver records
  // via the staff form (handling duplicate-name confirmations), compares them
  // on the merge surface, executes the merge transaction, and verifies the kept
  // record and redirects. Measured at 14.2s of 15s budget on run #39457126701 and
  // timed out past 15s under runner load on rerun.
  test.setTimeout(30_000);
  const name = `Quorrax Mergeling ${e2eNow().getTime()}`;
  const kept = await addDiver(page, {
    name,
    email: "quorrax.kept@example.com",
    phone: "+1 305 555 0171",
  });
  const duplicate = await addDiver(
    page,
    { name, email: "quorrax.counter@example.com", phone: "+1 305 555 0171" },
    true,
  );
  expect(duplicate).not.toBe(kept);

  await page.goto(duplicate);
  const panel = page.locator("#merge");
  await expect(panel.getByRole("heading", { name: "Possible duplicate records" })).toBeVisible();
  // The reasons render as one line, strongest first: the shared phone, then the name.
  await expect(panel.getByText("Same phone number · Same name", { exact: true })).toBeVisible();
  await panel.getByRole("link", { name: `Compare with ${name}` }).click();

  await page.getByRole("heading", { level: 1, name: "Merge duplicate records" }).waitFor();
  await expect(page.getByRole("heading", { name: "What moves to the kept record" })).toBeVisible();
  // The two emails disagree, so each is a choice; the kept record's is preselected.
  const keepKept = page.getByRole("radio", { name: "Keep quorrax.kept@example.com" });
  const keepDuplicate = page.getByRole("radio", { name: "Keep quorrax.counter@example.com" });
  await expect(keepKept).toBeChecked();
  await keepDuplicate.check();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Merge into ${name}` }).click();
  await page.waitForURL(
    (url) => url.pathname === kept && url.searchParams.get("notice") === "merged",
  );
  await expect(page.getByText("Diver records merged.", { exact: false })).toBeVisible();

  // The address the staffer chose is the one the kept record writes to.
  const header = page.locator("header").filter({ visible: true }).last();
  await expect(header.locator('a[href^="mailto:"]').filter({ visible: true })).toHaveAttribute(
    "href",
    /quorrax\.counter@example\.com/,
  );

  // And the merged record's old link follows its pointer.
  await page.goto(duplicate);
  await page.waitForURL((url) => url.pathname === kept);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("the preview refuses a pair already merged by sending the stale link to the kept record", async ({
  page,
}) => {
  // Sized for sequential multi-record setup: creates two separate diver records
  // via the staff form, navigates to the merge preview URL, merges, and asserts
  // stale preview link redirection to the kept record.
  test.setTimeout(30_000);
  const name = `Quorrax Stalelink ${e2eNow().getTime()}`;
  const kept = await addDiver(page, {
    name,
    email: "stalelink.kept@example.com",
    phone: "+1 305 555 0181",
  });
  const duplicate = await addDiver(
    page,
    { name, email: "stalelink.counter@example.com", phone: "+1 305 555 0181" },
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
