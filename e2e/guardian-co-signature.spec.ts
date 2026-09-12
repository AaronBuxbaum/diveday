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
  //
  // **With the address cleared** (issue #1453): the guardian's email is
  // optional, and the release a family with none gives is a release. The
  // browser used to refuse this submit on its own `required`; the server used
  // to refuse it after that.
  await page.getByLabel("Guardian’s full name").fill(`Jordan Guardian ${stamp}`);
  await page.getByLabel("Guardian’s email").fill("");
  await page.getByRole("button", { name: "Sign waiver" }).click();
  await expect(page.getByRole("heading", { name: /paperwork done/ })).toBeVisible();

  // What staff read back: not "Signed" and a date, but who signed it with them.
  await page.goto(record);
  await expect(page.getByText(/Good until/)).toBeVisible();
  await expect(page.getByText(`Co-signed by Jordan Guardian ${stamp} (parent)`)).toBeVisible();
});

/**
 * **The namesake family, on paper, at the counter** (issue #1573, owner
 * decision 2026-09-10; ADR 20260907-guardian-co-signature, decision 10).
 *
 * A parent whose ID reads exactly like their child's is refused on both paths
 * and has been since the co-signature shipped — which left a family standing
 * at a counter with a signed form the shop could not record. The paper path
 * now has one way through, and this walks it end to end from the surface a
 * staffer actually meets it on: the refusal, the confirmation it now offers,
 * and the record that comes out the other side saying who co-signed.
 *
 * **At the counter rather than on the diver record**, because the confirmation
 * says in the first person that the staffer watched two people sign, and the
 * counter is a door a diver is standing at. The diver record is the absentee
 * case by design, and the second half of this test pins that it offers no way
 * through (`dive-domain-expert`, issue #1453).
 *
 * The online half of the same rule does **not** move, and the test above pins
 * that: a guardian typing the diver's own name into `/waivers/[token]` is
 * still refused, because online the shop has no evidence a second person is
 * in the room. `src/db/waivers.test.ts` holds the adversarial version.
 */
test("a namesake parent can co-sign on paper, on the staffer's own attestation", async ({
  page,
  request,
}) => {
  // The demo shop has a blocked adult and a co-signed minor and nobody who is
  // both, so the one row this flow needs is seeded rather than built: Lena
  // Fischer, thirteen, with her release taken back out from under her. The
  // seat comes back by id because the queue addresses its departure that way.
  const seeded = await request.post("/api/test/seed-trouble-states?blockedMinor=1");
  expect(seeded.ok()).toBe(true);
  const { blockedMinor } = (await seeded.json()) as {
    blockedMinor?: { bookingId: string; tripId: string };
  };
  if (!blockedMinor) throw new Error("seed-trouble-states found no seat for the demo's minor");

  // By departure rather than by search: the counter re-renders its whole list
  // when a search lands, which rebuilds the row and closes the form on it
  // (`check-in.spec.ts` says so at length). Naming the trip puts her row on
  // screen in one render and keeps it there.
  await page.goto(`/shop/${SHOP}/check-in?trip=${blockedMinor.tripId}`);
  const row = page.locator("article").filter({ hasText: "Lena Fischer" }).filter({ visible: true });
  await expect(row.getByText("Blocked")).toBeVisible();

  const fillPaperForm = async () => {
    await row
      .getByLabel("I have this diver’s signed release on file", { exact: false })
      .filter({ visible: true })
      .check();
    await row.getByLabel("Parent or guardian who signed").fill("Lena Fischer");
    await row.getByLabel("Relationship").selectOption("parent");
  };

  await row.getByText("Mark signed on paper").click();
  await fillPaperForm();
  // **The refusal is still the default.** Nothing about this submission says
  // the staffer watched two people sign, so the shop is told what happened and
  // the release is not recorded.
  await row.getByRole("button", { name: "Record paper signature" }).click();
  const refused = page.locator("article").filter({ hasText: "Lena Fischer" }).filter({
    visible: true,
  });
  await expect(refused.getByText("The co-signer’s name is the diver’s own")).toBeVisible();

  // **And nothing the staffer typed was thrown away** (issue #1674). The
  // refusal used to redirect with a `?notice=`, which remounted these boxes
  // empty — so reaching the one new tick began by retyping the medical
  // attestation, the co-signer's name and the relationship, at a wet counter
  // with a family waiting. This is the surface where it bit hardest, because
  // the tick below appears only on this second pass.
  await expect(
    refused
      .getByLabel("I have this diver’s signed release on file", { exact: false })
      .filter({ visible: true }),
  ).toBeChecked();
  await expect(refused.getByLabel("Parent or guardian who signed")).toHaveValue("Lena Fischer");
  await expect(refused.getByLabel("Relationship")).toHaveValue("parent");

  // And the way through, which only this refusal draws: the form comes back
  // open, carrying the staffer's own assertion about what they saw. One tick
  // and one tap — nothing is retyped, which is the whole of #1674, and the
  // recording below would be refused on the browser's own `required` if the
  // relationship had not survived.
  const namesake = refused.getByLabel("This co-signer and this diver have the same name", {
    exact: false,
  });
  await expect(namesake).toBeVisible();
  await namesake.check();
  await refused.getByRole("button", { name: "Record paper signature" }).click();

  // The blocker is genuinely gone rather than hidden: the same immutable
  // record a self-service signature produces, so the counter offers the act it
  // was holding back.
  await expect(
    page
      .locator("article")
      .filter({ hasText: "Lena Fischer" })
      .filter({ visible: true })
      .getByRole("button", { name: "Check in Lena Fischer" }),
  ).toBeVisible();
});

/**
 * **The diver record offers no way through the same refusal**, and that is the
 * point rather than an omission.
 *
 * That door is the absentee case — the family phoned ahead, or handed a
 * release over months before they booked — and the confirmation next door
 * asserts that the staffer watched two people sign. Offering it to somebody
 * reading a scanned PDF in February asks them to attest to a thing nobody
 * witnessed, and `in_person_attested_namesake` exists to tell a regulator that
 * somebody did (`dive-domain-expert`, issue #1453).
 *
 * Driven by the notice in the URL rather than by a submit, because `?notice=`
 * is exactly the untrusted input a staffer could reach this state with by
 * hand: if the checkbox is drawn for anyone, it is drawn here.
 */
test("the diver record refuses a namesake co-signer and offers no tick", async ({ page }) => {
  const stamp = Date.now();
  const diver = `Namesake E2E Diver ${stamp}`;

  await page.goto(`/shop/${SHOP}/divers/new`);
  await page.getByLabel("Full name").fill(diver);
  await page.getByLabel("Email").fill(`namesake-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add diver" }).click();
  await page.waitForURL(new RegExp(`/shop/${SHOP}/divers/[0-9a-f-]{36}`));
  const record = new URL(page.url()).pathname;

  await page.goto(`${record}?edit=1`);
  await page.getByLabel("Date of birth").fill(daysFromNow(-365 * 13));
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toContainText("Diver details updated");

  const waiverCard = page.getByRole("region", { name: "Waiver" });
  await page.goto(record);
  await waiverCard.getByText("Send options", { exact: true }).click();
  await waiverCard.getByRole("button", { name: "Mark signed on paper" }).click();
  await page.getByLabel("I have this diver’s signed release on file", { exact: false }).check();
  await page.getByLabel("Parent or guardian who signed").fill(diver);
  await page.getByLabel("Relationship").selectOption("parent");
  await page.getByRole("button", { name: "Record paper signature" }).click();

  // Refused, and told where the confirmation lives instead of being offered one
  // here. The form is still standing with what was typed in it (issue #1674) —
  // this door loses nothing either, it just has no way through.
  await expect(page.getByText("The co-signer’s name is the diver’s own")).toBeVisible();
  await expect(page.getByText("record the release at the check-in counter")).toBeVisible();
  await expect(page.getByLabel("Parent or guardian who signed")).toHaveValue(diver);
  await expect(page.getByLabel("Relationship")).toHaveValue("parent");
  await expect(
    page.getByLabel("I have this diver’s signed release on file", { exact: false }),
  ).toBeChecked();
  await expect(
    page.getByLabel("This co-signer and this diver have the same name", { exact: false }),
  ).toHaveCount(0);
});
