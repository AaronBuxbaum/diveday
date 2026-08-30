import { expect, signedInAsOwner, test } from "./fixtures";
import { manifestRow, openManifestPerson, openTripFromBoard, openTripTab } from "./helpers";

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
  // The panel rests collapsed behind its summary line; working in it starts
  // by opening it. Every buddy action redirects back with `?buddies=open`,
  // so it stays open across the steps below.
  await expect(page.getByRole("heading", { name: "Buddy teams" })).toBeVisible();
  await page.getByRole("heading", { name: "Buddy teams" }).click();

  // The seeded teams are already at a glance — including the trio the old
  // two-body model could not express at all, with the divemaster marked as
  // crew rather than reading like one more diver.
  const teamPanel = page.locator("section", {
    has: page.getByRole("heading", { name: "Buddy teams" }),
  });
  // Scoped to the **membership** chips, not to any text in the row. A team row
  // also carries the "dives with" constraints its divers stated (issue #1068),
  // so a bare `li hasText` matched Diego's team when asked for Omar's — the
  // same over-loose shape this spec's own note below warns about.
  const teamRow = (name: string) =>
    teamPanel
      .locator("li")
      .filter({ has: page.locator("li[data-buddy-member]", { hasText: name }) })
      .first();
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
  // The form redirects back with `?buddies=open`; wait for that navigation to
  // land before touching a row, or the disclosure opened below is opened on a
  // DOM the redirect is about to replace.
  await expect(page).toHaveURL(/buddies=open/);
  await expect(teamRow("Omar Haddad")).toContainText("Sam Whitfield");

  // Their rows carry the team, one tap away. A team label is not an exception,
  // so it does not earn the row's single capsule (ADR
  // 20260827-the-departure-is-two-working-surfaces, decision 1) — it reads in
  // the person's own panel, and unconditionally on the printed sheet. Rows are
  // scoped to `> ul > li` so a name can only match the row it belongs to: a
  // bare `li hasText` also matched the *other* row once the chip text landed in
  // it, which is how this spec's first CI run misread Omar's row as Sam's.
  const omarRow = manifestRow(page, "Omar Haddad");
  const samRow = manifestRow(page, "Sam Whitfield");
  await openManifestPerson(omarRow);
  await expect(page.getByRole("dialog").getByRole("region", { name: "Buddy team" })).toContainText(
    "Sam Whitfield",
  );
  await openManifestPerson(samRow);
  await expect(page.getByRole("dialog").getByRole("region", { name: "Buddy team" })).toContainText(
    "Omar Haddad",
  );

  // Checkpoint navigation belongs to the manifest surface, so close the
  // Person Sheet before using the tab's link; its backdrop otherwise correctly
  // intercepts the click as a modal interaction.
  await page.getByRole("dialog").getByRole("button", { name: "Close person details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // After dive 1: Omar is recorded back aboard while Sam has no result yet.
  // **That is not a split** — an alarm is earned by a recorded fact, never by
  // the absence of one (ADR 20260827-the-departure-is-two-working-surfaces,
  // decision 4). A crew starts the surface-interval count believing everyone is
  // back, so the first diver counted in must not paint their buddy red before
  // anybody has said a word about them.
  await page
    .getByRole("link", { name: "After dive 1" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);
  const boardOmar = omarRow.getByRole("button", { name: "Mark boarded" });
  await boardOmar.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await boardOmar.click();
  // The settled control's accessible name is its undo-bearing aria-label
  // (PR #607 review), which replaces "Boarded ☑️" rather than extending it.
  await expect(omarRow.getByRole("button", { name: "Boarded — tap again to undo" })).toBeVisible();
  await expect(page.getByText("buddy team is split", { exact: false })).toHaveCount(0);

  // A human records Sam not back aboard — from his own panel, the deliberate
  // two-step (decision 3) — and *now* the split is the loudest thing on the
  // page, on the row of the diver who is aboard.
  await openManifestPerson(samRow);
  const samNotBack = page.getByRole("dialog").getByRole("button", { name: "Mark not back aboard" });
  await samNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await samNotBack.click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Not back aboard", exact: true }),
  ).toBeVisible();
  await openManifestPerson(omarRow);
  await expect(
    page.getByRole("dialog").getByText("Buddy team: Sam Whitfield · Someone unaccounted for"),
  ).toBeVisible();
  await expect(
    page.getByText("1 buddy team is split. Someone is back aboard, someone is not."),
  ).toBeVisible();
  // The alert informs; it never blocks. The pinned count row still names
  // what actually keeps the checkpoint open — awaiting divers — beside it.
  await expect(
    page
      .locator('section[aria-labelledby="roll-call-progress-heading"]')
      .locator("dl > div")
      .filter({ hasText: "Awaiting" }),
  ).toBeVisible();

  // Sam climbs the ladder. Asserting he is aboard over a stated missing-diver
  // mark is recorded from his own panel, never from the row — ADR
  // 20260815-offline-can-unsay-a-missing-diver calls it "the one tap on this
  // surface that turns the loudest row the product has into green", and the
  // retraction beside it costs exactly the same two gestures. His row carries
  // no tap at all while the mark stands.
  await expect(samRow.getByRole("button", { name: "Mark boarded" })).toHaveCount(0);
  await openManifestPerson(samRow);
  const boardSam = page.getByRole("dialog").getByRole("button", { name: /^Mark back aboard/ });
  await boardSam.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await boardSam.click();
  await expect(samRow.getByRole("button", { name: "Boarded — tap again to undo" })).toBeVisible();
  await openManifestPerson(omarRow);
  await expect(page.getByRole("dialog").getByRole("region", { name: "Buddy team" })).toContainText(
    "Sam Whitfield",
  );
  await expect(page.getByRole("dialog").getByText("Someone unaccounted for")).toHaveCount(0);
  await expect(page.getByText("buddy team is split", { exact: false })).toHaveCount(0);
});

test("a team grows, a member leaves, and dissolving is the explicit act", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  // Same collapsed-at-rest panel as the first test: open it once, and the
  // `?buddies=open` redirects keep it open across the acts below.
  await expect(page.getByRole("heading", { name: "Buddy teams" })).toBeVisible();
  await page.getByRole("heading", { name: "Buddy teams" }).click();

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
  const tomRow = manifestRow(page, "Tom Okafor");
  await openManifestPerson(tomRow);
  await expect(page.getByRole("dialog").getByText("Buddy team:", { exact: false })).toHaveCount(0);
});
