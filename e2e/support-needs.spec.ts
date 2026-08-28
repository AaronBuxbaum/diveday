import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";
import { e2eNow, openManifestPerson, openThreadStep, signInAs, tripPathByTitle } from "./helpers";

const SHOP = DEMO_SHOP_SLUG;
const TRIP = "Two-Tank Reef — Christ of the Abyss";

/**
 * **What a diver arranges once has to reach the people who arrange it.**
 *
 * The accessible-dive support-needs record (ADR
 * 20260827-support-needs-are-a-record-about-the-dive), end to end: the diver
 * answers on their own readiness page after the sale, and the crew reads it on
 * the prep list the day before and on the manifest at the rail.
 *
 * The ADR names the failure this covers in as many words — "a support-diver
 * count silently lost between `/ready` and the manifest is a diver in the water
 * without the help they arranged". `src/lib/support-needs-carry.test.ts` pins
 * each assembly; this pins the whole path, including the two seams a unit test
 * cannot see: the form actually posting, and the staff pages actually rendering
 * what came back.
 *
 * It uses a diver booked by this test rather than a seeded one, so it states
 * its own arrangements and never depends on what `seed-support-needs.ts`
 * happens to hold.
 */
test("what a diver arranges on their own page reaches prep and the manifest", async ({ page }) => {
  const stamp = e2eNow().getTime();
  const diverName = `Adaeze Nwosu ${stamp}`;

  await page.goto(`/s/${SHOP}`);
  await page.locator("li").filter({ hasText: TRIP }).getByRole("link", { name: TRIP }).click();
  // The booking form is controlled, so wait for hydration before typing —
  // otherwise a fill lands before React attaches and is silently lost.
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill(diverName);
  await page.getByLabel("Email").fill(`adaeze-${stamp}@example.com`);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page).toHaveURL(/\/ready\//);

  // The question is optional and asked here and nowhere else: after the sale,
  // on the diver's own page. It is never on the public booking form, which is
  // why the form above never showed it. It rides inside the spine's Day-of
  // details step and gates nothing — that step settles on the recency question
  // alone (ADR 20260827-the-divers-thread, decision 3).
  await openThreadStep(page, "dayof");
  const support = page.getByRole("heading", { name: "Anything we should set up for you?" });
  await expect(support).toBeVisible();

  // Who supplies them is asked separately from how many, because the shop's
  // action is opposite in each — two more crew to roster, or two more seats.
  await page.getByRole("radio", { name: "Yes — please arrange them" }).check();
  await page.getByLabel("How many?").fill("2");
  await page.getByRole("checkbox", { name: "A hand or a transfer getting aboard" }).check();
  await page.getByRole("checkbox", { name: "A lift getting into and out of the water" }).check();
  await page.getByRole("checkbox", { name: "In writing" }).check();
  await page.getByLabel("Equipment to adapt or bring").fill("webbed gloves, short fin");
  await page
    .getByLabel("Someone who should be on the same boat and team as you")
    .fill("Marisol Vega");
  await page.getByRole("button", { name: "Save arrangements" }).click();
  // Filtered, not bare: the readiness page carries a second live region (the
  // gear match indicator), so the save's own confirmation is named.
  await expect(
    page.getByRole("status").filter({ hasText: "the crew will have that" }),
  ).toBeVisible();

  // Answered once: the diver's own page reads it back rather than asking again.
  await expect(page.getByLabel("How many?")).toHaveValue("2");
  await expect(page.getByRole("radio", { name: "Yes — please arrange them" })).toBeChecked();

  await signInAs(page, DEV_STAFF_LOGINS.owner);
  const tripPath = await tripPathByTitle(page, SHOP, TRIP);

  // The prep list, where the day is packed. The boat's total is stated beside
  // the divers who asked — and refuses nothing: this departure is not held up,
  // blocked, or marked short by any of it.
  await page.goto(`${tripPath}/prep`);
  const prep = page.getByRole("region", { name: "Dive support" });
  await expect(prep).toContainText(diverName);
  await expect(prep).toContainText("2 support divers to arrange");
  await expect(prep).toContainText("2 support divers in the water — the shop arranges");
  await expect(prep).toContainText("Help getting aboard");
  await expect(prep).toContainText("Lift in and out of the water");
  await expect(prep).toContainText("Briefing in writing");
  await expect(prep).toContainText("Equipment: webbed gloves, short fin");
  await expect(prep).toContainText("Dives with Marisol Vega");

  // And the manifest at the rail, where the plan for dive two gets made. On
  // screen it is inside the row's person panel, beside the rental fit and the
  // pickup — the same door, in the same voice, because it is the same kind of
  // fact (ADR 20260827-the-departure-is-two-working-surfaces, decision 2). The
  // printed sheet always carries it, open or not.
  await page.goto(`${tripPath}/manifest`);
  const row = page.locator("#roll-call-list > ul > li").filter({ hasText: diverName });
  await openManifestPerson(row);
  await expect(row.getByText("2 support divers in the water — the shop arranges")).toBeVisible();
  await expect(row.getByText("Dives with Marisol Vega")).toBeVisible();

  // The last refusal, checked where it would actually bite. This diver was
  // booked minutes ago, so they carry the two blockers anybody in that state
  // carries — an unsigned waiver and no certification on file. What is pinned
  // here is that nothing they *arranged* ever joins that list: no support
  // count, no lift, no briefing, no named buddy (ADR
  // 20260827-support-needs-are-a-record-about-the-dive, fourth refusal —
  // nothing here gates).
  const blockers = row.getByRole("listitem");
  await expect(blockers).not.toHaveCount(0);
  for (const reason of await blockers.allInnerTexts()) {
    expect(reason).not.toMatch(/support|lift|aboard|briefing|adapt|Marisol/i);
  }
});
