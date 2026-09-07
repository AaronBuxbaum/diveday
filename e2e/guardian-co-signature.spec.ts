import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, waiverLinkFromToast } from "./helpers";

/**
 * **A minor's release is signed twice** (ADR 20260907-guardian-co-signature).
 *
 * The whole flow, in the order a shop meets it: a date of birth goes on a
 * diver's record, the release link they are sent asks for a parent as well,
 * signing it alone is refused by the *server* and not merely by the browser,
 * and once both signatures are on it the record says who co-signed.
 *
 * Its own diver, minted per run, rather than the seeded thirteen-year-old:
 * hers is already co-signed (`DEMO_GUARDIANS` in `src/db/seed-bookings.ts`, so
 * the demo boat shows the co-signature rather than a permanent blocker), and a
 * spec that unpicked that would be changing the fixture every other spec on the
 * shared shop reads.
 */
const SHOP = DEMO_SHOP_SLUG;

signedInAsOwner();

test("a minor's release asks for a parent, refuses without one, and names who co-signed", async ({
  page,
}) => {
  const stamp = Date.now();
  const diver = `Minor E2E Diver ${stamp}`;

  await page.goto(`/shop/${SHOP}/divers/new`);
  await page.getByLabel("Full name").fill(diver);
  await page.getByLabel("Email").fill(`minor-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add diver" }).click();
  await page.waitForURL(new RegExp(`/shop/${SHOP}/divers/[0-9a-f-]{36}`));
  const record = new URL(page.url()).pathname;

  // Thirteen. `?edit=1` names the disclosure the date of birth lives behind
  // rather than relying on where a freshly-added record happens to land.
  await page.goto(`${record}?edit=1`);
  await page.getByLabel("Date of birth").fill(daysFromNow(-365 * 13));
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toContainText("Diver details updated");

  // Back to the record's own URL first: the save lands on a `?notice=`, and its
  // banner is a second `role="status"` beside the copy toast that
  // `waiverLinkFromToast` reads.
  await page.goto(record);
  await page.getByText("Send options", { exact: true }).click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await page.goto(await waiverLinkFromToast(page));

  // The section the rule adds, and the one thing about it that is not a field:
  // the page's single Sign button now belongs to the guardian's card, so
  // nobody signs above a section they have not read.
  await expect(page.getByRole("heading", { name: "Parent or guardian" })).toBeVisible();
  await expect(page.getByText(`${diver} is under 18`)).toBeVisible();

  await page.getByLabel("Type your full name").fill(diver);
  await page.getByLabel("I have read this waiver, understand it, and agree to it.").check();
  const noRadios = page.getByRole("radio", { name: "No" });
  await noRadios.first().waitFor();
  const questionCount = await noRadios.count();
  for (let i = 0; i < questionCount; i++) {
    await noRadios.nth(i).check();
  }

  // **Adversarial.** The guardian's controls carry `required`, so a browser
  // blocks an empty submit on its own. Strip that and the *server* still has to
  // refuse — a signed release is the document, and client convenience is not
  // what stands between a twelve-year-old and one they gave alone.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(
      '[name="guardianName"], [name="guardianEmail"], [name="guardianRelationship"], [name="guardianAcknowledged"]',
    )) {
      el.removeAttribute("required");
    }
  });
  await page.getByRole("button", { name: "Sign waiver" }).click();
  await expect(page.getByText("Type the guardian’s full name.")).toBeVisible();
  // And the link survives the refusal: a family that missed the section is not
  // sent back to the shop for a new one.
  await expect(page.getByRole("heading", { name: "Parent or guardian" })).toBeVisible();

  // The one refusal a browser can never make: the diver typing their own name
  // as their own guardian. One signature in two hats.
  await page.getByLabel("Guardian’s full name").fill(diver);
  await page.getByLabel("Guardian’s email").fill(`parent-${stamp}@example.com`);
  await page.getByLabel(`Relationship to ${diver}`).selectOption("parent");
  await page.getByLabel("I am this diver’s parent or legal guardian", { exact: false }).check();
  await page.getByRole("button", { name: "Sign waiver" }).click();
  await expect(page.getByText("The guardian’s name can’t be the diver’s own.")).toBeVisible();

  // Signed by both, and the page settles exactly as an adult's does. No
  // `/ready` hand-off here: this diver holds no seat, so the thread has no
  // next step to send them to.
  await page.getByLabel("Guardian’s full name").fill(`Jordan Guardian ${stamp}`);
  await page.getByRole("button", { name: "Sign waiver" }).click();
  await expect(page.getByRole("heading", { name: /paperwork done/ })).toBeVisible();

  // What staff read back: not "Signed" and a date, but who signed it with them.
  await page.goto(record);
  await expect(page.getByText(/Good until/)).toBeVisible();
  await expect(page.getByText(`Co-signed by Jordan Guardian ${stamp} (parent)`)).toBeVisible();
});
