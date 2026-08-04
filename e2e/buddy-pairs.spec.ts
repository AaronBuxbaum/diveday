import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";

signedInAsOwner();

/**
 * Buddy pairs on the roll call (ADR 20260804-buddy-pairs): pair two divers on
 * the manifest, board one after a dive, and the split team is the loudest
 * thing short of a stated missing diver — then board the buddy and watch it
 * settle. The seed already carries two teams (Tom & Lena, Diego & June), so
 * the spec also proves a fresh pairing lands beside them and that an odd
 * remainder is simply normal.
 */
test("staff pair divers, roll call raises the split team, and boarding the buddy settles it", async ({
  page,
}) => {
  // Board → trip → manifest, a pairing, a checkpoint switch, and two
  // roll-call writes — a long serial flow, same budget reasoning as
  // manifest.spec.ts's own long test.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await expect(page.getByRole("heading", { name: "Buddy teams" })).toBeVisible();

  // The seeded teams are already at a glance, with who made the call.
  await expect(page.getByText("Lena Fischer · Tom Okafor")).toBeVisible();
  await expect(page.getByText("Diego Alvarez · June Park")).toBeVisible();

  // Pair two of the unpaired divers.
  await page.getByLabel("First diver").selectOption({ label: "Omar Haddad" });
  await page.getByLabel("Second diver").selectOption({ label: "Sam Whitfield" });
  await page.getByRole("button", { name: "Pair as buddies" }).click();
  await expect(page.getByText("Omar Haddad · Sam Whitfield")).toBeVisible();

  // Their rows now wear the quiet chip, both ways round. Each row is
  // anchored on its own <h3> name — a bare `li hasText` would also match the
  // *other* row once the chip text ("Buddy: Sam Whitfield") lands in it, and
  // `.first()` then asserts against whichever row the roster orders first
  // (exactly how this spec's first CI run misread Omar's row as Sam's).
  const diverRow = (name: string) =>
    page
      .locator("#roll-call-list li")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  const omarRow = diverRow("Omar Haddad");
  const samRow = diverRow("Sam Whitfield");
  await expect(omarRow.getByText("Buddy: Sam Whitfield")).toBeVisible();
  await expect(samRow.getByText("Buddy: Omar Haddad")).toBeVisible();

  // After dive 1: Omar is recorded back aboard, Sam has no result yet — the
  // exact state a deck watches for, and the page must raise it unprompted.
  await page
    .getByRole("link", { name: "After dive 1" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);
  const boardOmar = omarRow.getByRole("button", { name: "Mark boarded" });
  await boardOmar.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await boardOmar.click();
  await expect(omarRow.getByRole("button", { name: "Boarded ✓" })).toBeVisible();
  await expect(omarRow.getByText("Buddy: Sam Whitfield · Buddy unaccounted for")).toBeVisible();
  await expect(
    page.getByText("1 buddy team is split — one back aboard, one unaccounted for."),
  ).toBeVisible();
  // The alert informs; it never blocks. The completeness line still names
  // what actually keeps the checkpoint open — awaiting divers — beside it.
  await expect(page.getByText(/divers? still to call\./)).toBeVisible();

  // Sam comes back aboard, and the pair settles without anyone dismissing
  // anything.
  const boardSam = samRow.getByRole("button", { name: "Mark boarded" });
  await boardSam.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await boardSam.click();
  await expect(samRow.getByRole("button", { name: "Boarded ✓" })).toBeVisible();
  await expect(omarRow.getByText("Buddy: Sam Whitfield", { exact: true })).toBeVisible();
  await expect(omarRow.getByText("Buddy unaccounted for")).toHaveCount(0);
  await expect(page.getByText("buddy team is split", { exact: false })).toHaveCount(0);
});

test("pairing refuses the same diver twice, and unpairing is explicit", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await expect(page.getByRole("heading", { name: "Buddy teams" })).toBeVisible();

  // The same diver in both slots is a server-side refusal with words, not a
  // silent no-op.
  await page.getByLabel("First diver").selectOption({ label: "Omar Haddad" });
  await page.getByLabel("Second diver").selectOption({ label: "Omar Haddad" });
  await page.getByRole("button", { name: "Pair as buddies" }).click();
  await expect(page.getByText("Pick two different divers.")).toBeVisible();

  // Unpair a seeded team; both divers return to the picker (an explicit act,
  // and the only path to re-pairing).
  const tomLenaRow = page.locator("li", { hasText: "Lena Fischer · Tom Okafor" });
  await tomLenaRow.getByRole("button", { name: "Unpair" }).click();
  await expect(page.getByText("Lena Fischer · Tom Okafor")).toHaveCount(0);
  // Same h3-anchored row shape as the first test: Tom's row must not be
  // found via some other row's chip text.
  await expect(
    page
      .locator("#roll-call-list li")
      .filter({ has: page.getByRole("heading", { name: "Tom Okafor", exact: true }) })
      .getByText("Buddy:", { exact: false }),
  ).toHaveCount(0);
});
