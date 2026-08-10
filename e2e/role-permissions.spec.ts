import type { Page } from "@playwright/test";
import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAs, test } from "./fixtures";
import { openSettingsRow } from "./helpers";

/**
 * H-14 (ADR 20260724-role-authorization) draws real boundaries on five staff
 * surfaces. This lens signs in as three roles and checks each sees only what
 * its role admits: the daily crew (captain) is denied money, the legal waiver,
 * diver deletion, and trip configuration; an instructor may configure trips but
 * not money or legal; the owner reaches everything. The server actions re-check
 * regardless — these assertions cover the UI-hiding courtesy the ADR also asks
 * for. Each role's sign-in comes from its own cached per-worker session
 * (`signedInAs`, e2e/fixtures.ts) rather than walking the sign-in form live in
 * every test — a traced CI failure on the captain test found that live sign-in
 * plus this test's own 8 navigations summed past the default 15s test budget.
 */
const SHOP = DEMO_SHOP_SLUG;

async function firstDiverDetailHref(page: Page): Promise<string> {
  await page.goto(`/shop/${SHOP}/divers`);
  const href = await page
    .locator(`a[href^="/shop/${SHOP}/divers/"]`)
    .filter({ visible: true })
    .first()
    .getAttribute("href");
  if (!href) throw new Error("no diver detail link found");
  return href;
}

async function firstTripManageHref(page: Page): Promise<string> {
  // Signed-in staff see the schedule's cards link straight to trip management.
  await page.goto(`/shop/${SHOP}/schedule/board`);
  const href = await page
    .locator(`a[href^="/shop/${SHOP}/trips/"]`)
    .filter({ visible: true })
    .first()
    .getAttribute("href");
  if (!href) throw new Error("no trip management link found");
  return href;
}

test.describe("H-14 role permissions", () => {
  test.describe("captain", () => {
    signedInAs("captain");

    test("the daily crew (captain) is denied money, legal, deletion, and trip config", async ({
      page,
    }) => {
      // This test does the most sequential full-page navigation of the three
      // in this file — 5 denied-surface checks (2 of them redirects) before
      // ever reaching the shared trip-manage assertions, against 3 for the
      // other two. A traced CI failure measured every `page.goto()` here at
      // roughly 1-1.3s and each redirect's `toHaveURL` settling at 1.6-2.3s —
      // not stuck, just each one genuinely taking that long under 2-worker
      // load — and those 8 navigations alone summed past the default 15s
      // budget before the test's actual assertions ever ran, even after
      // moving sign-in to the cached per-role session above (`signedInAs`)
      // removed the live sign-in's own ~2s. Same reasoning as
      // visual.spec.ts's `test.setTimeout` on its heaviest capture sequence:
      // aggregate per-navigation cost accumulating across many sequential
      // steps in one test, not a hang this override would be masking.
      test.setTimeout(30_000);

      // Waiver — the legal instrument — has no use for the daily crew, so the
      // surface doesn't exist for them: bounced to Today, not shown read-only.
      await page.goto(`/shop/${SHOP}/waivers`);
      await expect(page).toHaveURL(`/shop/${SHOP}`);
      await expect(page.locator('textarea[name="body"]').filter({ visible: true })).toHaveCount(0);

      // Its Signatures tab (task 155) — read access to signed medical/waiver
      // records — takes the exact same gate, never a looser one just because
      // it's a sub-route.
      await page.goto(`/shop/${SHOP}/waivers/signatures`);
      await expect(page).toHaveURL(`/shop/${SHOP}`);
      await expect(page.getByRole("heading", { level: 1, name: "Signatures" })).toHaveCount(0);

      // Settings as a whole is owner/manager work now, not just the money
      // cards inside it: every card there changes the shop rather than the
      // day. The captain is bounced to Today with a reason, and none of the
      // page's forms exist for them at all.
      await page.goto(`/shop/${SHOP}/settings`);
      await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}(\\?|$)`));
      await expect(page.getByRole("button", { name: "Save rental catalog" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save shop address" })).toHaveCount(0);

      // Trip creation is hidden — and the board says whose job it is rather
      // than just omitting the control (ADR 20260806-one-trip-create-form).
      await page.goto(`/shop/${SHOP}/schedule/board?add=full`);
      await expect(page.getByText("limited to owners, managers, and instructors")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add a departure" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Put it on the board" })).toHaveCount(0);

      // Diver deletion is hidden — and so is the strictly stricter erasure
      // control below it, which is owner-only (ADR 20260802-diver-data-erasure).
      await page.goto(await firstDiverDetailHref(page));
      await expect(page.getByRole("heading", { name: "Remove from active divers" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Erase personal data" })).toHaveCount(0);

      // On a trip's Overview, trip *definition* is hidden, but the day-of operating
      // actions the glossary assigns to crew — conditions, crew, weather cancel —
      // stay available.
      await page.goto(await firstTripManageHref(page));
      await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
      // The conditions form sits behind its disclosure now; the visible half
      // for a captain is the section's own toggle (Publish or Edit, depending
      // on whether a prediction is live).
      await expect(page.getByText(/Write a crew prediction|Edit crew prediction/)).toBeVisible();
      // Crew editing is unconditional (no config-gated form around it), so its
      // presence for a captain is the heading itself, not a submit button.
      await expect(page.getByRole("heading", { name: "Crew", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel trip" })).toBeVisible();
    });

    /**
     * Every gated surface bounces a refused staffer to the nearest parent
     * *with a notice code that parent handles*. Reports, Team, and Import used
     * to redirect to Today with nothing at all — indistinguishable from a dead
     * link, and the reason task 82 named "silent teleport". Its own test
     * rather than more steps in the one above, which already runs 8 sequential
     * navigations against a 30s budget.
     *
     * Not URL assertions: `FlashParams` strips `?notice=` on mount, so the
     * banner text is the durable evidence that the code arrived and was
     * recognized — a code the destination does not handle renders nothing and
     * fails here.
     */
    test("a refused surface lands somewhere that says why", async ({ page }) => {
      test.setTimeout(30_000);

      // Revenue is owner/manager work — Today explains, rather than dumping
      // the captain on a page that looks like they simply mis-clicked.
      await page.goto(`/shop/${SHOP}/reports`);
      await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}(\\?|$)`));
      await expect(page.getByText(/Reports read the shop's revenue/i)).toBeVisible();

      // Team and Import are Settings sub-pages, and they used to land their
      // refusal on Settings — the nearest parent that could explain it. Now
      // that Settings takes the same owner/manager gate, that parent bounces
      // the same staffer again and their reason is lost on the way. Both land
      // on Today instead, which is where the reason survives.
      await page.goto(`/shop/${SHOP}/settings/team`);
      await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}(\\?|$)`));
      await expect(page.getByText(/Team management is limited to owners/i)).toBeVisible();

      await page.goto(`/shop/${SHOP}/settings/import`);
      await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}(\\?|$)`));
      await expect(
        page.getByText(/Importing writes divers' personal and medical records/i),
      ).toBeVisible();
    });
  });

  test.describe("instructor", () => {
    signedInAs("instructor");

    test("an instructor may configure trips but not money or legal", async ({ page }) => {
      // Trip configuration is instructor work — the form is present.
      await page.goto(`/shop/${SHOP}/schedule/board?add=full`);
      await expect(page.getByRole("button", { name: "Put it on the board" })).toBeVisible();

      // Money and the legal waiver are still owner/manager only — including
      // its Signatures tab.
      await page.goto(`/shop/${SHOP}/waivers`);
      await expect(page).toHaveURL(`/shop/${SHOP}`);
      await expect(page.locator('textarea[name="body"]').filter({ visible: true })).toHaveCount(0);

      await page.goto(`/shop/${SHOP}/waivers/signatures`);
      await expect(page).toHaveURL(`/shop/${SHOP}`);
      await expect(page.getByRole("heading", { level: 1, name: "Signatures" })).toHaveCount(0);

      // An instructor runs courses, not the shop's configuration.
      await page.goto(`/shop/${SHOP}/settings`);
      await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}(\\?|$)`));
      await expect(page.getByRole("button", { name: "Save rental catalog" })).toHaveCount(0);
    });
  });

  test.describe("owner", () => {
    signedInAs("owner");

    test("the owner reaches every gated surface", async ({ page }) => {
      await page.goto(`/shop/${SHOP}/waivers`);
      await expect(page.locator('textarea[name="body"]').filter({ visible: true })).toBeVisible();

      await page.goto(`/shop/${SHOP}/waivers/signatures`);
      await expect(page.getByRole("heading", { level: 1, name: "Signatures" })).toBeVisible();

      await page.goto(`/shop/${SHOP}/settings`);
      // The catalog form waits behind its summary row on the settings hub.
      await openSettingsRow(page, "What we rent");
      await expect(page.getByRole("button", { name: "Save rental catalog" })).toBeVisible();

      await page.goto(`/shop/${SHOP}/schedule/board?add=full`);
      await expect(page.getByRole("button", { name: "Put it on the board" })).toBeVisible();

      await page.goto(await firstDiverDetailHref(page));
      await expect(page.getByRole("heading", { name: "Remove from active divers" })).toBeVisible();
      // Erasure is the one control past removal, and only the owner has it.
      await expect(page.getByRole("heading", { name: "Erase personal data" })).toBeVisible();

      // Trip definition is available to the owner.
      await page.goto(await firstTripManageHref(page));
      // The details form waits behind its Edit disclosure (summary-first
      // Overview) — the owner sees the toggle, and the form behind it.
      await page.getByText("Edit details", { exact: true }).click();
      await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    });

    /** The other half of the refusal test above: the owner is never bounced. */
    test("the owner reaches reports, team, and import without a refusal", async ({ page }) => {
      await page.goto(`/shop/${SHOP}/reports`);
      await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/reports`));

      await page.goto(`/shop/${SHOP}/settings/team`);
      await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/settings/team`));

      await page.goto(`/shop/${SHOP}/settings/import`);
      await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/settings/import`));
    });
  });
});

/**
 * The calendar subscription is the one page under `/settings` that is *not*
 * shop configuration: a staffer's own feed of their own shifts, filed there by
 * URL only. Gating Settings must not take it with them — that would remove a
 * personal tool from exactly the roles who work the shifts.
 */
test.describe("the calendar subscription survives the settings gate", () => {
  signedInAs("captain");

  test("a captain can still set up their own calendar feed", async ({ page }) => {
    await page.goto(`/shop/${SHOP}/settings/calendar`);
    // Not bounced: the page renders for them.
    await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/settings/calendar`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("and can find it without going through Settings, which they cannot open", async ({
    page,
  }) => {
    await page.goto(`/shop/${SHOP}`);
    await page.getByRole("button", { name: "Search" }).click();
    // Named, like e2e/search.spec.ts does it: the page carries more than one
    // combobox once the palette is open, so a bare role query is ambiguous.
    await page.getByRole("combobox", { name: /Search divers/ }).fill("calendar");
    await expect(page.getByRole("option", { name: /Calendar subscription/i })).toBeVisible();
  });
});
