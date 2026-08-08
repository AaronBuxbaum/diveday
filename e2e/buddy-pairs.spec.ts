import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";

signedInAsOwner();

/**
 * Buddy teams on the roll call (ADR 20260804-buddy-teams): build a team on the
 * manifest, board one member after a dive, and the split team is the loudest
 * thing short of a stated missing diver — then board the rest and watch it
 * settle. The seed already carries two teams (Tom & Lena; Diego, June, and
 * Keiko leading), so the spec also proves a fresh team lands beside them, that
 * a divemaster-led trio renders as one, and that an odd remainder is normal.
 */
test("staff build a buddy team, roll call raises the split, and boarding the rest settles it", async ({
  page,
}) => {
  // Board → trip → manifest, a team build, a checkpoint switch, and two
  // roll-call writes — a long serial flow, same budget reasoning as
  // manifest.spec.ts's own long test.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await expect(page.getByRole("heading", { name: "Buddy teams" })).toBeVisible();

  // The seeded teams are already at a glance — including the trio the old
  // two-body model could not express at all, with the divemaster marked as
  // crew rather than reading like one more diver.
  const teamPanel = page.locator("section", {
    has: page.getByRole("heading", { name: "Buddy teams" }),
  });
  const teamRow = (name: string) => teamPanel.locator("li", { hasText: name }).first();
  await expect(teamRow("Lena Fischer")).toContainText("Tom Okafor");
  const trio = teamRow("Diego Alvarez");
  await expect(trio).toContainText("June Park");
  await expect(trio).toContainText("Keiko Tanaka (crew)");

  // Build a team from two of the free divers. The builder sits behind its
  // own disclosure now — forming a team is the rare act on this page.
  await page.getByText("New buddy team").click();
  await page.getByRole("checkbox", { name: "Omar Haddad" }).check();
  await page.getByRole("checkbox", { name: "Sam Whitfield" }).check();
  await page.getByRole("button", { name: "Form buddy team" }).click();
  await expect(teamRow("Omar Haddad")).toContainText("Sam Whitfield");

  // Their rows now wear the quiet chip, both ways round. Each row is
  // anchored on its own <h3> name — a bare `li hasText` would also match the
  // *other* row once the chip text ("Buddy team: Sam Whitfield") lands in it,
  // and `.first()` then asserts against whichever row the roster orders first
  // (exactly how this spec's first CI run misread Omar's row as Sam's).
  const diverRow = (name: string) =>
    page
      .locator("#roll-call-list li")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  const omarRow = diverRow("Omar Haddad");
  const samRow = diverRow("Sam Whitfield");
  await expect(omarRow.getByText("Buddy team: Sam Whitfield")).toBeVisible();
  await expect(samRow.getByText("Buddy team: Omar Haddad")).toBeVisible();

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
  await expect(
    omarRow.getByText("Buddy team: Sam Whitfield · Someone unaccounted for"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "1 buddy team is split — someone is back aboard and someone is unaccounted for.",
    ),
  ).toBeVisible();
  // The alert informs; it never blocks. The completeness line still names
  // what actually keeps the checkpoint open — awaiting divers — beside it.
  await expect(page.getByText(/divers? still to call\./)).toBeVisible();

  // Sam comes back aboard, and the team settles without anyone dismissing
  // anything.
  const boardSam = samRow.getByRole("button", { name: "Mark boarded" });
  await boardSam.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await boardSam.click();
  await expect(samRow.getByRole("button", { name: "Boarded ✓" })).toBeVisible();
  await expect(omarRow.getByText("Buddy team: Sam Whitfield", { exact: true })).toBeVisible();
  await expect(omarRow.getByText("Someone unaccounted for")).toHaveCount(0);
  await expect(page.getByText("buddy team is split", { exact: false })).toHaveCount(0);
});

test("a team grows, a member leaves, and dissolving is the explicit act", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await expect(page.getByRole("heading", { name: "Buddy teams" })).toBeVisible();

  const teamPanel = page.locator("section", {
    has: page.getByRole("heading", { name: "Buddy teams" }),
  });
  const tomLena = teamPanel.locator("li", { hasText: "Lena Fischer" }).first();

  // A team of two offers no per-member remove: at two the act is a dissolve,
  // which has its own button and its own entry on the trail.
  await expect(tomLena.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  // Add a third, and now members can leave individually. Assertions go through
  // the per-member Remove control rather than the row's text: once Omar is off
  // the team he reappears in that same row's "Add to this team" picker, so
  // `not.toContainText("Omar Haddad")` would be asserting against an <option>.
  await tomLena.getByLabel("Add to this team").selectOption({ label: "Omar Haddad" });
  await tomLena.getByRole("button", { name: "Add", exact: true }).click();
  const grown = teamPanel.locator("li", { hasText: "Lena Fischer" }).first();
  await expect(grown.getByRole("button", { name: "Remove Omar Haddad" })).toBeVisible();
  await grown.getByRole("button", { name: "Remove Omar Haddad" }).click();
  const shrunk = teamPanel.locator("li", { hasText: "Lena Fischer" }).first();
  await expect(shrunk.getByRole("button", { name: "Remove Omar Haddad" })).toHaveCount(0);
  // Back to two, so the per-member control is gone again.
  await expect(shrunk.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  // One person is not a team — a single tick is a worded refusal, not a
  // silent no-op.
  await page.getByText("New buddy team").click();
  await page.getByRole("checkbox", { name: "Omar Haddad" }).check();
  await page.getByRole("button", { name: "Form buddy team" }).click();
  await expect(page.getByText("A buddy team needs at least two people.")).toBeVisible();

  // Dissolve a seeded team; its divers return to the builder (an explicit
  // act, and the only path to re-teaming them). Two teams become one, and Lena
  // stops being a *member* — asserted on an anchored member name, because the
  // surviving team's "Add to this team" picker lists her as an <option> the
  // moment she is free, and a substring filter would match that instead.
  await expect(teamPanel.getByRole("button", { name: "Dissolve team" })).toHaveCount(2);
  await teamPanel
    .locator("li", { hasText: "Lena Fischer" })
    .first()
    .getByRole("button", { name: "Dissolve team" })
    .click();
  await expect(teamPanel.getByRole("button", { name: "Dissolve team" })).toHaveCount(1);
  await expect(teamPanel.getByRole("listitem").filter({ hasText: /^Lena Fischer$/ })).toHaveCount(
    0,
  );
  await page.getByText("New buddy team").click();
  await expect(page.getByRole("checkbox", { name: "Lena Fischer" })).toBeVisible();
  // Same h3-anchored row shape as the first test: Tom's row must not be
  // found via some other row's chip text.
  await expect(
    page
      .locator("#roll-call-list li")
      .filter({ has: page.getByRole("heading", { name: "Tom Okafor", exact: true }) })
      .getByText("Buddy team:", { exact: false }),
  ).toHaveCount(0);
});
