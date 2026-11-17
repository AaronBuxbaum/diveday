import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  manifestRow,
  openDeckPerson,
  openIfClosed,
  openManifestPerson,
  openTripFromBoard,
  openTripPhase,
  openTripTab,
} from "./helpers";

const t = staffTranslator("en-US");
signedInAsOwner();

async function openBuddyTeamBuilder(page: Page) {
  const heading = page.getByRole("heading", { name: "Buddy teams" });
  const panel = page.locator("details").filter({ has: heading }).first();
  await openIfClosed(panel);
  const builder = panel.locator("details").filter({ hasText: "New buddy team" }).first();
  await openIfClosed(builder);
}

/**
 * Buddy teams on the roll call (ADR 20260804-buddy-teams): build a team on the
 * The day, board one member after a dive, and the split team is the loudest
 * thing short of a stated missing diver — then board the rest and watch it
 * settle. The seed already carries two teams (Tom & Lena; Diego, June, and
 * Keiko leading), so the spec also proves a fresh team lands beside them, that
 * a divemaster-led trio renders as one, and that an odd remainder is normal.
 */
test("staff build a buddy team, roll call raises the split, and boarding the rest settles it", async ({
  page,
}) => {
  // Board → trip → The day, a team build, a checkpoint switch, and two
  // roll-call writes — a long serial flow, same budget reasoning as
  // manifest.spec.ts's own long test.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripPhase(page, "ready");
  // The panel can arrive open when a team warning needs attention. Inspect its
  // native state before opening so the test never toggles an already-open fold
  // shut. Buddy actions redirect back with `?buddies=open`.
  await openBuddyTeamBuilder(page);

  // The seeded teams are already at a glance — including the trio the old
  // two-body model could not express at all, with the divemaster marked as
  // crew rather than reading like one more diver.
  const teamPanel = page.locator("section", {
    has: page.getByRole("heading", { name: "Buddy teams" }),
  });
  // Scoped to the **membership** chips, not to any text in the row: a bare
  // `li hasText` is the over-loose shape this spec's own note below warns
  // about.
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
  await openBuddyTeamBuilder(page);
  await page.getByRole("checkbox", { name: "Omar Haddad" }).check();
  await page.getByRole("checkbox", { name: "Sam Whitfield" }).check();
  await page.getByRole("button", { name: "Form buddy team" }).click();
  // The form redirects back with `?buddies=open`; wait for that navigation to
  // land before touching a row, or the disclosure opened below is opened on a
  // DOM the redirect is about to replace.
  await expect(page).toHaveURL(/buddies=open/);
  await expect(teamRow("Omar Haddad")).toContainText("Sam Whitfield");

  const tripPath = new URL(page.url()).pathname;
  await page.goto(`${tripPath}/manifest?checkpoint=after_dive_1`);
  await openDeckPerson(page, "Omar Haddad");
  await page
    .getByRole("button", {
      name: t("manifest.deck.record", { name: "Omar Haddad" }),
      exact: true,
    })
    .click();
  await expect(
    page.locator('[data-deck-screen="receipt"]').getByRole("heading", {
      name: "Omar Haddad",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("buddy team is split", { exact: false }).filter({ visible: true }),
  ).toHaveCount(0);

  // Each exception is opened for its named person. A cached row belonging to
  // the previous person is never used after navigation.
  await openManifestPerson(await manifestRow(page, "Sam Whitfield"));
  const samNotBack = page.getByRole("dialog").getByRole("button", { name: "Mark not back aboard" });
  await samNotBack.click();
  const receipt = page.locator('[data-deck-screen="receipt"]');
  await expect(receipt.getByRole("heading", { name: "Sam Whitfield", exact: true })).toBeVisible();
  await expect(receipt.getByText(t("manifest.deck.savedMissing"), { exact: true })).toBeVisible();
  await openManifestPerson(await manifestRow(page, "Omar Haddad"));
  await expect(page.getByRole("dialog").getByRole("region", { name: "Buddy team" })).toContainText(
    "Sam Whitfield",
  );
  await expect(
    page.getByText("Sam not back aboard", { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();

  // Explicit correction is still made inside Sam's own evidence panel.
  await openManifestPerson(await manifestRow(page, "Sam Whitfield"));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Mark back aboard/ })
    .click();
  await expect(receipt.getByRole("heading", { name: "Sam Whitfield", exact: true })).toBeVisible();
  await expect(receipt.getByText(t("manifest.deck.savedAboard"), { exact: true })).toBeVisible();
  await openManifestPerson(await manifestRow(page, "Omar Haddad"));
  await expect(page.getByRole("dialog").getByRole("region", { name: "Buddy team" })).toContainText(
    "Sam Whitfield",
  );
  await expect(page.getByRole("dialog").getByText("Sam not back aboard")).toHaveCount(0);
  await expect(
    page.getByText("buddy team is split", { exact: false }).filter({ visible: true }),
  ).toHaveCount(0);
});

test("a team grows, a member leaves, and dissolving is the explicit act", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripPhase(page, "ready");
  // Same collapsed-at-rest panel as the first test: open it once, and the
  // `?buddies=open` redirects keep it open across the acts below.
  await expect(page.getByRole("heading", { name: "Buddy teams" })).toBeVisible();
  await openBuddyTeamBuilder(page);

  const teamPanel = page.locator("section", {
    has: page.getByRole("heading", { name: "Buddy teams" }),
  });
  const tomLena = teamPanel
    .locator("li")
    .filter({ has: page.locator("li[data-buddy-member]", { hasText: "Lena Fischer" }) })
    .first();

  // A team of two offers no per-member remove: at two the act is a dissolve,
  // which has its own button and its own entry on the trail.
  await expect(tomLena.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  // Add a third, and now members can leave individually. Assertions go through
  // the per-member Remove control rather than the row's text: once Omar is off
  // the team he reappears in that same row's "Add to this team" picker, so
  // `not.toContainText("Omar Haddad")` would be asserting against an <option>.
  await tomLena.getByLabel("Add to this team").selectOption({ label: "Omar Haddad" });
  await tomLena.getByRole("button", { name: "Add", exact: true }).click();
  const grown = teamPanel
    .locator("li")
    .filter({ has: page.locator("li[data-buddy-member]", { hasText: "Lena Fischer" }) })
    .first();
  await expect(grown.getByRole("button", { name: "Remove Omar Haddad" })).toBeVisible();
  await grown.getByRole("button", { name: "Remove Omar Haddad" }).click();
  const shrunk = teamPanel
    .locator("li")
    .filter({ has: page.locator("li[data-buddy-member]", { hasText: "Lena Fischer" }) })
    .first();
  await expect(shrunk.getByRole("button", { name: "Remove Omar Haddad" })).toHaveCount(0);
  // Back to two, so the per-member control is gone again.
  await expect(shrunk.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  // One person is not a team — a single tick is a worded refusal, not a
  // silent no-op.
  await openBuddyTeamBuilder(page);
  await page.getByRole("checkbox", { name: "Omar Haddad" }).check();
  await page.getByRole("button", { name: "Form buddy team" }).click();
  await expect(page.getByText("A buddy team needs at least two people.")).toBeVisible();

  // Dissolve a seeded team; its divers return to the builder (an explicit
  // act, and the only path to re-teaming them). Two teams become one, and Lena
  // stops being a *member* — asserted on an anchored member name, because the
  // surviving team's "Add to this team" picker lists her as an <option> the
  // moment she is free, and a substring filter would match that instead.
  await expect(teamPanel.getByRole("button", { name: "Dissolve team" })).toHaveCount(2);
  await shrunk.getByRole("button", { name: "Dissolve team" }).click();
  await expect(teamPanel.getByRole("button", { name: "Dissolve team" })).toHaveCount(1);
  await expect(teamPanel.getByRole("listitem").filter({ hasText: /^Lena Fischer$/ })).toHaveCount(
    0,
  );
  await openBuddyTeamBuilder(page);
  await expect(page.getByRole("checkbox", { name: "Lena Fischer" })).toBeVisible();
  await openTripTab(page, "Manifest");
  // Same h3-anchored row shape as the first test: Tom's row must not be
  // found via some other row's chip text.
  const tomRow = await manifestRow(page, "Tom Okafor");
  await openManifestPerson(tomRow);
  await expect(page.getByRole("dialog").getByText("Buddy team:", { exact: false })).toHaveCount(0);
});
