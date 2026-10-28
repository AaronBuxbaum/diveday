/**
 * Visual captures: shop-wide states on a private shop: an empty emergency reference, no nitrox, a logo on file, operational trust warnings.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, makeActivitySafe, test } from "./fixtures";
import {
  manifestRow,
  offlineCopySaved,
  openOnThisPhone,
  openTripFromBoard,
  openTripTab,
} from "./helpers";
import {
  capture,
  expectOverviewMapSites,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  REEF_TRIP,
  SPANISH,
  SURFACE_TIMEOUT_MS,
  settleOfflineShellWorker,
  staffCopy,
  VISUAL_STEP_BOUNDS,
  waitForSiteLibrary,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

/**
 * **The emergency card with nothing in it.**
 *
 * The one panel on a safety surface that renders *because* the shop has not
 * answered a question — a red-bordered prompt where five phone numbers should
 * be, read by a crew at the rail. Every other capture in this file sees the
 * seeded shop, which fills the field in deliberately ("an unseeded shop would
 * photograph its own empty state on every capture of that page", `seed.ts`),
 * so this state had never been looked at and the settings capture above
 * claimed, wrongly, that it had been.
 *
 * A private shop, because clearing the reference is shop-wide configuration —
 * the reset restores the schedule, not the settings, so doing this to
 * blue-mantis would hand a blank emergency card to whichever spec ran next in
 * this worker (ADR 20260815-per-test-private-shops).
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — the unanswered emergency reference`, () => {
    // **A pinned identity, or this capture is noise.** The minted shop's name
    // renders in the staff header and its slug-derived owner email in the dev
    // banner, and `generateDemoShopIdentity` draws both at random — so without
    // this the capture reported as changed on the very next pull request,
    // "Verdant Trench Dive Co" against "Verdant Lagoon Dive Center", with
    // nothing about the page itself different. Masking those two lines is the
    // other way out and the repo refuses it: a masked capture cannot catch what
    // it covers.
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "harbour-lantern-dive-co",
    });

    /**
     * **The one first-run question a trading shop can still have open.**
     *
     * A minted shop is the only fixture that can honestly show this: it has a
     * board and has never answered the units question, which is exactly the
     * shape issue #835 is about. The canonical demo finishes its onboarding in
     * the seed, so it has no row — and arranging one on it would not work
     * anyway, because `/api/test/reset` restores the schedule and **not** the
     * `shops` columns, so a nulled `units_confirmed_at` would follow the worker
     * into every later test in the run. A test that writes shop-wide settings
     * takes a shop of its own (AGENTS.md); this one does not have to write
     * anything at all.
     */
    test(`the queue still asks an unanswered setup question (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // The home itself, and nothing to open. The question is bound to no
      // departure, and it ranks in Today's one "Needs you" list, which
      // the spine renders unfolded — where the old `?view=urgency` queue put it
      // inside a "This week" band a reader had to expand. That queue is gone
      // (ADR 20260827-clearwater-surface-language), `?view=` 308s here, and
      // "This week" is a folded disclosure beside Tomorrow.
      await page.goto(`/shop/${privateShop.slug}`);
      // The row's own words, not a timing guess.
      await page.getByText(/picked for where you are/).waitFor();
      await capture(page, "today-units-unconfirmed", scheme);
    });

    /**
     * **A dive site with the shop's own planning note on it** (issue #1204),
     * in the editor that writes it and on the library row that carries it.
     *
     * Its own shop: the note is written onto a dive-site row, and
     * `/api/test/reset` restores the schedule rather than the library.
     */
    test(`a dive site's planning note renders true to the design (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/shop/${privateShop.slug}/dive-sites`);
      await page.getByRole("heading", { level: 1, name: "Dive-site library" }).waitFor();
      await page.getByRole("link", { name: "Molasses Reef", exact: true }).first().click();
      await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
      await page
        .locator("details#briefing-planning")
        .filter({ visible: true })
        .locator("> summary")
        .click();
      await page
        .getByLabel("What to remember about running this site")
        .fill("The entry silted up after the storm. Brief the swim-through before you go in.");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      // **Wait for the save's own redirect, not for the text we just typed.**
      // The frame worth keeping is one navigation on from the form — the note
      // in the list a shop plans against — and the assertion that used to
      // stand here read the field back for the value it had been filled with a
      // line earlier. It therefore passed instantly, whether or not the write
      // had landed, and the `goto` below tore the page down with the action
      // still in flight: the trace shows the POST to the site page ending at
      // status -1, and the library rendering the row without a note. This is
      // the `action-race` shape `.claude/rules/e2e.md` names, wearing an
      // `expect` that satisfies `check:e2e-hygiene` while waiting for nothing.
      // `?notice=saved` is written by `revalidateAndRedirect` only once the row
      // is durably saved.
      await page.waitForURL(/[?&]notice=saved/);
      await page.goto(`/shop/${privateShop.slug}/dive-sites`);
      await page.getByText("The entry silted up after the storm").waitFor();
      await waitForSiteLibrary(page);
      await capture(page, "dive-site-planning-note", scheme, {
        beforeShot: () => expectOverviewMapSites(page, 8),
      });
    });

    /**
     * **The shore contact's address, refused without its consent** (H-118).
     * An address DiveDay sends to saves only with the box that records the
     * shore contact agreed; this is the refusal a staff member meets when
     * they type one and leave the box clear, on the page they were editing.
     * A shop of its own, because a saved address would follow the worker. Its
     * descriptions carry the review's words: confirmed by a link first, and
     * (a minted shop being a demo shop) that demo shops send nothing.
     */
    test(`the emergency reference refuses a shore address without consent (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      test.setTimeout(FLOW_TIMEOUT_MS);
      await page.goto(`/shop/${privateShop.slug}/settings/emergency-reference`);
      await page.locator("#emergency-alerts summary").click();
      await page.getByLabel("Shore contact’s email for roll-call alerts").fill("shore@example.com");
      await page.getByRole("button", { name: "Save emergency reference" }).click();
      await page.getByText(staffCopy("settings.main.notice.shoreAlertConsentMissing")).waitFor();
      await capture(page, "settings-emergency-shore-consent-missing", scheme);
    });

    /**
     * **The one state on this page where an absence *is* the information**
     * (issue #1363), photographed on both surfaces that render it.
     *
     * The staffed capture is read by a manager at a desk, who can go and fix
     * it. The offline one is read by a divemaster at the rail from cache, with
     * no signal and usually no permission to open Settings at all — which is
     * why the string underneath stopped handing them an errand. Neither frame
     * existed before, and the populated card sits inside
     * `offline-manifest-roll-call` already, so this is the half that was
     * photographed nowhere.
     *
     * One test, not two: clearing the reference through the shop's own form is
     * the expensive half, and the offline snapshot is primed from the staff
     * manifest *after* the clear has landed, so the copy the shell reads back
     * carries it.
     */
    test(`the manifest prompts for an emergency reference nobody filled in (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // Settings → clear → manifest → the saved copy, in one flow.
      test.setTimeout(FLOW_TIMEOUT_MS);
      await page.goto(`/shop/${privateShop.slug}/settings/emergency-reference`);
      await page
        .getByRole("button", { name: staffCopy("settings.main.emergency.submit") })
        .waitFor();
      // A private shop may start with no contacts. Open and clear only
      // existing rows; the next unused slot is already empty.
      const contactSummaries = page.locator(
        'details[id^="emergency-contact-"]:not(#emergency-contact-new) > summary',
      );
      const contactCount = await contactSummaries.count();
      for (let index = 0; index < contactCount; index += 1) {
        await contactSummaries.nth(index).click();
      }
      for (const id of ["emergency-response", "emergency-alerts"]) {
        const editor = page.locator(`#${id}`);
        if ((await editor.getAttribute("open")) === null) await editor.locator("summary").click();
      }
      const alertAddress = page.locator('input[name="shoreAlertEmail"]');
      const hadAlertAddress = (await alertAddress.inputValue()).trim().length > 0;
      // Clear through the shop's form whether the reference started empty
      // or populated, including any independently configured alert address.
      const fields = page
        .locator(
          'input[name^="emergencyLabel-"], input[name^="emergencyPhone-"], ' +
            'input[name="emergencyVessel"], input[name="emergencyShoreContact"], ' +
            'input[name="shoreAlertEmail"]',
        )
        .filter({ visible: true });
      await expect(fields).not.toHaveCount(0);
      for (const field of await fields.all()) await field.fill("");
      await page
        .getByRole("checkbox", { name: staffCopy("settings.main.emergency.shoreAlertConsent") })
        .uncheck();
      await page.locator('textarea[name="emergencyPlan"]').fill("");
      await page.getByRole("button", { name: "Save emergency reference" }).click();
      // Observe the completed save before the manifest/offline empty-state
      // assertions. Clearing an address has its own saved outcome.
      await page
        .getByText(
          staffCopy(
            hadAlertAddress
              ? "settings.main.notice.shoreAlertCleared"
              : "settings.main.notice.emergencySaved",
          ),
        )
        .waitFor();

      await page.goto(`/shop/${privateShop.slug}/schedule/board`);
      await openTripFromBoard(page, REEF_TRIP);
      await openTripTab(page, "Manifest");
      await page
        .getByRole("button", { name: "Emergency numbers & response plan" })
        .filter({ visible: true })
        .click();
      // The line itself, not just the heading — the whole point of the
      // capture is the state where there is nothing under it.
      await page.getByText("No emergency numbers recorded").waitFor();
      await capture(page, "manifest-emergency-empty", scheme);

      // The same absence, on the copy the boat falls back to. Straight to the
      // route with the trip's own id rather than through the manifest's "On
      // this phone" group: the capture above has already resized this page
      // through three viewports, and the disclosure does not reopen reliably
      // afterwards. `offlineCopySaved` is the honest precondition either way —
      // it waits on the freshness pill, which is the summary line's own report
      // that a copy exists.
      await settleOfflineShellWorker(page);
      await offlineCopySaved(page);
      const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/?]+)/)?.[1];
      await page.goto(`/offline-manifest?trip=${tripId}`);
      // The empty state's own words, not a timeout: the snapshot is primed in the
      // background from the staff manifest, and if it had been written before
      // the clear landed this frame would photograph a *populated* card under
      // an "empty" name. Waiting on the rendered text makes that loud.
      await page.getByText("No emergency numbers recorded").waitFor();
      await capture(page, "offline-manifest-emergency-empty", scheme);
    });

    /**
     * **A shop with no packages on sale** (issue #2418): the page answers with
     * an empty state and a door back to the schedule rather than a 404. Photographed
     * before the capture below adds one, so the same minted shop shows both.
     */
    test(`the public packages page with nothing on sale renders true to the design (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/s/${privateShop.slug}/packages`);
      await page.getByRole("heading", { name: "No packages right now" }).waitFor();
      await capture(page, "public-packages-empty", scheme);
    });

    test(`public package choices preserve shared and different terms (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      const addPackage = async (
        name: string,
        dives: number,
        price: string,
        scope: "all" | "fun_dives",
        validUntil?: string,
      ) => {
        await page.goto(`/shop/${privateShop.slug}/promos/packages`);
        const create = page.locator("#package-new");
        await expect(create.locator("summary")).toBeVisible();
        if ((await create.getAttribute("open")) === null) await create.locator("summary").click();
        await page.getByLabel("What you call it").fill(name);
        await page.getByLabel("Dives included").fill(String(dives));
        await page.getByLabel("Price", { exact: true }).fill(price);
        await page.getByLabel("Covers", { exact: true }).selectOption(scope);
        if (validUntil) await page.getByLabel("Usable through", { exact: true }).fill(validUntil);
        await page.getByRole("button", { name: "Add package", exact: true }).click();
        await expect(page.getByText(name, { exact: true })).toBeVisible();
        await expect(page.getByText("Package added", { exact: true })).toBeVisible();
      };
      await addPackage("Five-dive card", 5, "200", "fun_dives");
      await addPackage("Ten-dive card", 10, "375", "fun_dives");
      await page.goto(`/s/${privateShop.slug}/packages`);
      await expect(page.getByRole("radio")).toHaveCount(2);
      await expect(page.getByText("Courses not included", { exact: false })).toHaveCount(1);
      await expect(page.getByRole("group", { name: "Dive packages" })).toHaveAccessibleDescription(
        /One dive is one tank/,
      );
      await capture(page, "public-packages-shared-terms", scheme);

      await addPackage("Course-and-dive card", 6, "270", "all", "2026-12-31");
      await page.goto(`/s/${privateShop.slug}/packages`);
      await expect(page.getByRole("radio")).toHaveCount(3);
      await expect(page.getByText("Courses included", { exact: true })).toBeVisible();
      await expect(page.getByText("Courses not included", { exact: true })).toHaveCount(2);
      await expect(page.getByText(/Use by Dec\s31,\s2026/)).toBeVisible();
      await expect(page.getByRole("group", { name: "Dive packages" })).toHaveAccessibleDescription(
        /One dive is one tank/,
      );
      await capture(page, "public-packages-mixed-scope", scheme);
    });

    /**
     * **The packages a diver can buy online** (owner decision 2026-10-09).
     * Its own shop: a package is shop configuration, which `/api/test/reset`
     * leaves standing, so writing one into blue-mantis would follow the worker
     * into every later capture of that shop's public pages — the new Packages
     * tab included.
     */
    test(`the public packages page renders true to the design (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/shop/${privateShop.slug}/promos#dive-packages`);
      // Fill does not wait for an inert ancestor: the live session must unlock first.
      await expect(page.locator("#main-content")).not.toHaveAttribute("inert");
      await expect(page.locator("[data-staff-session-lock]")).toHaveCount(0);
      await page.locator("#package-new summary").click();
      await page.getByLabel("What you call it").fill("Ten-dive card");
      await page.getByLabel("Dives included").fill("10");
      await page.getByLabel("Price").fill("450");
      await page.getByRole("button", { name: "Add package" }).click();
      await expect(
        page.getByRole("list", { name: "Dive packages", exact: true }).getByRole("button", {
          name: "More for Ten-dive card",
          exact: true,
        }),
      ).toBeVisible();
      await page.goto(`/s/${privateShop.slug}/packages`);
      await page.getByRole("heading", { level: 1, name: "Dive packages" }).waitFor();
      await page.getByRole("button", { name: "Buy for $450" }).waitFor();
      await capture(page, "public-packages", scheme);
    });
  });
}

/**
 * **A shop that doesn't fill nitrox.**
 *
 * With the catalog off and no live request left on the departure, Total and Air
 * collapse into a single tile — there is nothing for a second number to
 * distinguish. The reef charter is the fixture that can show it: unlike the
 * wreck charter it never had a nitrox request seeded onto it, so turning the
 * catalog off leaves no live data to keep the tile alive (the same premise
 * `e2e/nitrox.spec.ts` asserts on).
 *
 * **A shop of its own, because this writes shop-wide configuration.**
 * `shops.rental_items` is not restored by the per-test reset — it puts back
 * three `shops` columns and no others — so this used to bracket the capture in
 * a `try/finally` that turned blue-mantis's catalog back on. That is the shape
 * AGENTS.md and ADR 20260815-per-test-private-shops refuse, and on 2026-08-23
 * it failed exactly as predicted: the capture hit the known unattributed
 * Chromium wedge, both paint waits and the screenshot burned the test's
 * ceiling, and the timeout landed on the **first line of the `finally`** — so
 * the revert never ran and blue-mantis was left not filling nitrox for every
 * later test in that worker. A `finally` is not isolation: it competes for the
 * same clock as the failure it is there for, and it does not run at all when
 * the worker dies. `e2e/nitrox.spec.ts` moved off this pattern for the same
 * reason; this capture was the one site left on it, and its comment still
 * pointed at that file as the precedent.
 *
 * The wedge itself is unchanged and unfixed by this — a wedged renderer still
 * fails the test, and ci.yml's visual job still reruns the failed captures once
 * on the probe's "wedged, not slow" verdict. What changes is the blast radius:
 * the failure now costs one capture instead of quietly re-premising the rest of
 * the shard.
 *
 * **A pinned identity**, for the same reason `manifest-emergency-empty` has
 * one: the minted shop's name renders in the staff header and its slug-derived
 * owner email in the dev banner, and `generateDemoShopIdentity` draws both at
 * random — so an unpinned capture reports as changed on the very next pull
 * request with nothing about the page itself different.
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — a shop that stops filling nitrox`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "slack-tide-dive-charters",
    });

    test(`the prep page's tank tile collapses with nitrox off (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // The mint and the live sign-in the fixture pays for, then one settings
      // round-trip and board → trip → Prep before the capture.
      test.setTimeout(FLOW_TIMEOUT_MS);
      await page.goto(`/shop/${privateShop.slug}/settings/rentals`);
      await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
      await page.getByRole("button", { name: "Save rentals" }).click();
      // The page comes back with its saved notice — the destination's own
      // render, not a timing guess.
      await page.getByText("Rentals saved").waitFor();

      await page.goto(`/shop/${privateShop.slug}/schedule/board`);
      await openTripFromBoard(page, REEF_TRIP);
      await openTripTab(page, "Prep");
      await page.getByRole("heading", { name: "Tanks" }).waitFor();
      await capture(page, "prep-no-nitrox", scheme);
    });
  });
}

/**
 * **The shop profile row with a logo and a cover photo on file** (the K-247
 * follow-up and the K-13 review): the logo in the square the storefront crops
 * it to, its tick on the tile's corner and its caption under it; the cover
 * photo in a gallery cell; the two photo pickers; and the badges' fieldset
 * with its hint.
 *
 * No other capture opens this row, and no seeded shop has a logo. Blue Mantis
 * has a cover photo and badges but no logo, and giving it one would put a logo
 * in the header of every staff capture. So this takes a shop of its own,
 * minted in Blue Mantis's brand plus a logo (`privateShopBrand`). It writes
 * nothing: the shop is only the fixture that can hold a logo.
 *
 * **A pinned identity**, for the same reason `manifest-emergency-empty` has
 * one: the minted shop's name renders in the staff header and its slug-derived
 * owner email in the dev banner.
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — the shop profile with a logo on file`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "reef-light-divers",
      privateShopBrand: true,
    });

    test(`the profile row's stored photos and pickers render true to the design (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // A page of its own since #1854.
      await page.goto(`/shop/${privateShop.slug}/settings/profile`);
      await page.getByRole("button", { name: "Save profile" }).waitFor();
      // The stored photos' own boxes: a mint that lost its brand fails here,
      // rather than photographing the empty row under this name.
      await page.getByRole("checkbox", { name: "Remove current logo" }).waitFor();
      await page.getByRole("checkbox", { name: "Remove the cover photo" }).waitFor();
      await capture(page, "settings-profile", scheme);
    });
  });
}
// Operational trust warning states (#2742, #2727, #2807). Synthetic departures

// on a pinned private shop; every frame first proves its warning is visible.
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — operational trust warnings`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "operational-trust-divers",
    });

    test(`offline total persons exceeds the certificate (${scheme})`, async ({
      page,
      request,
      context,
      privateShop,
    }) => {
      test.setTimeout(FLOW_TIMEOUT_MS);
      const response = await request.post(
        `/api/test/seed-trouble-states?operationalTrust=capacity&shop=${privateShop.slug}`,
      );
      expect(response.ok()).toBe(true);
      const { operationalTrust: state } = await response.json();
      await page.goto(`/shop/${privateShop.slug}/trips/${state.tripId}/manifest`);
      await offlineCopySaved(page);
      await settleOfflineShellWorker(page);
      await openOnThisPhone(page);
      await page.getByRole("link", { name: "Open offline roll call" }).click();
      await page.waitForURL(/offline-manifest/);
      await expect(page.getByRole("heading", { name: "Ari Vale" })).toBeVisible();
      await context.setOffline(true);
      const crew = page
        .getByRole("region", { name: "Crew aboard" })
        .getByRole("listitem")
        .filter({ hasText: state.crewName });
      await crew
        .getByRole("button", { name: staffCopy("manifest.crewMarkAboard"), exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({
          hasText: staffCopy("manifest.headCountOverTotalPersonsAboard", { aboard: 6, limit: 5 }),
        }),
      ).toBeVisible();
      await capture(page, "offline-manifest-total-persons", scheme);
      await context.setOffline(false);
    });

    test(`a junior's blocked team and ashore teammate warn visibly (${scheme})`, async ({
      page,
      request,
      privateShop,
    }) => {
      test.setTimeout(FLOW_TIMEOUT_MS);
      const response = await request.post(
        `/api/test/seed-trouble-states?operationalTrust=ashore&shop=${privateShop.slug}`,
      );
      expect(response.ok()).toBe(true);
      const { operationalTrust: state } = await response.json();
      await page.goto(`/shop/${privateShop.slug}/trips/${state.tripId}/manifest`);
      await expect(
        page.getByText(
          staffCopy("manifest.buddyTeamCaution", {
            reason: staffCopy("manifest.buddyPartyLeftReason.young_child"),
          }),
        ),
      ).toBeVisible();
      await expect(page.getByText(staffCopy("manifest.buddyTeamNotCleared"))).toBeVisible();
      await expect(
        manifestRow(page, "Bea Quill").getByText(
          staffCopy("shared.buddyTeam.ashoreNamed", { name: "Ari" }),
          { exact: true },
        ),
      ).toBeVisible();
      await offlineCopySaved(page);
      await capture(page, "manifest-buddy-operational-warnings", scheme);
    });

    test(`an intro team's manual pairing caution is visible (${scheme})`, async ({
      page,
      request,
      privateShop,
    }) => {
      test.setTimeout(FLOW_TIMEOUT_MS);
      const response = await request.post(
        `/api/test/seed-trouble-states?operationalTrust=intro&shop=${privateShop.slug}`,
      );
      expect(response.ok()).toBe(true);
      const { operationalTrust: state } = await response.json();
      await page.goto(`/shop/${privateShop.slug}/trips/${state.tripId}/manifest`);
      await expect(
        page.getByText(
          staffCopy("manifest.buddyTeamCaution", {
            reason: staffCopy("manifest.buddyPartyLeftReason.intro_course"),
          }),
        ),
      ).toBeVisible();
      await offlineCopySaved(page);
      await capture(page, "manifest-buddy-intro-warning", scheme);
    });

    test(`a historic hull mismatch keeps its original papers (${scheme})`, async ({
      page,
      request,
      privateShop,
    }) => {
      test.setTimeout(FLOW_TIMEOUT_MS);
      const response = await request.post(
        `/api/test/seed-trouble-states?operationalTrust=historic&shop=${privateShop.slug}`,
      );
      expect(response.ok()).toBe(true);
      const { operationalTrust: state } = await response.json();
      await page.goto(`/shop/${privateShop.slug}/trips/${state.tripId}/log`);
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: staffCopy("incidentExport.boatChanged", { boatName: "Trust I" }) }),
      ).toBeVisible();
      await expect(page.getByText("TRUST1", { exact: true })).toBeVisible();
      await capture(page, "departure-log-historic-hull-warning", scheme);
    });

    test.describe("Spanish historical hull warning", () => {
      test(`a historic hull warning fits in Spanish (${scheme})`, async ({
        browser,
        context,
        request,
        privateShop,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const response = await request.post(
          `/api/test/seed-trouble-states?operationalTrust=historic&shop=${privateShop.slug}`,
        );
        expect(response.ok()).toBe(true);
        const { operationalTrust: state } = await response.json();
        // privateShop signs in through the English form. Carry that real
        // session to a Spanish reader after authentication, including its
        // navigator.language, which capture() checks against the baseline.
        const spanishContext = await browser.newContext({
          baseURL: new URL(context.pages()[0].url()).origin,
          colorScheme: scheme,
          locale: SPANISH,
          storageState: await context.storageState(),
        });
        try {
          const page = makeActivitySafe(await spanishContext.newPage());
          await page.goto(`/shop/${privateShop.slug}/trips/${state.tripId}/log`);
          const spanish = staffTranslator(SPANISH);
          await expect(
            page
              .getByRole("status")
              .filter({ hasText: spanish("incidentExport.boatChanged", { boatName: "Trust I" }) }),
          ).toBeVisible();
          await capture(page, "departure-log-historic-hull-warning", scheme, { locale: SPANISH });
        } finally {
          await spanishContext.close();
        }
      });
    });
  });
}
