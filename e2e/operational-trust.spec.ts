import type { APIRequestContext, Page } from "@playwright/test";
import type {
  OperationalState,
  seedOperationalTrust,
} from "../src/app/api/test/seed-trouble-states/operational-states";
import { staffTranslator } from "../src/i18n/staff-messages";
import { OFFLINE_MANIFEST_SHELL_VERSION } from "../src/lib/offline-manifests";
import { expect, test } from "./fixtures";
import {
  manifestRow,
  offlineCopySaved,
  openIfClosed,
  openManifestPerson,
  openOnThisPhone,
  openTripAboutRow,
} from "./helpers";

const copy = staffTranslator("en-US");
type State = Awaited<ReturnType<typeof seedOperationalTrust>>;

async function seed(
  request: APIRequestContext,
  slug: string,
  state: OperationalState,
): Promise<State> {
  const response = await request.post(
    `/api/test/seed-trouble-states?operationalTrust=${state}&shop=${slug}`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).operationalTrust;
}

async function openOffline(page: Page, manifest: string) {
  await page.goto(manifest);
  await offlineCopySaved(page);
  await expect
    .poll(() =>
      page.evaluate(async (version) => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const base = `diveday-offline-manifest-shell-${version}`;
        // Production names the cache by build too (`-<build id>`).
        const name = (await caches.keys()).find((k) => k === base || k.startsWith(`${base}-`));
        const cache = name ? await caches.open(name) : null;
        return (
          registration?.active?.state === "activated" &&
          cache !== null &&
          (await cache.match("/offline-manifest")) !== undefined
        );
      }, OFFLINE_MANIFEST_SHELL_VERSION),
    )
    .toBe(true);
  await openOnThisPhone(page);
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await page.waitForURL(/offline-manifest/);
  await expect(page.getByRole("heading", { name: "Ari Vale" })).toBeVisible();
}

test("offline total-person warning follows queued crew counts without refusing the count", async ({
  page,
  request,
  context,
  privateShop,
}) => {
  // Private-shop mint/sign-in, manifest encryption, worker activation and two offline writes.
  test.setTimeout(45_000);
  const state = await seed(request, privateShop.slug, "capacity");
  await openOffline(page, `/shop/${privateShop.slug}/trips/${state.tripId}/manifest`);
  const warning = copy("manifest.headCountOverTotalPersonsAboard", {
    aboard: 6,
    limit: state.limit,
  });
  await expect(page.getByText(warning)).toHaveCount(0);
  await expect(
    page.getByText(copy("manifest.passengerSnorkelers", { count: 1 }), { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(copy("manifest.passengerRiders", { count: 1 }), { exact: false }),
  ).toBeVisible();
  await context.setOffline(true);
  const crew = page
    .getByRole("region", { name: "Crew aboard" })
    .getByRole("listitem")
    .filter({ hasText: state.crewName });
  await crew.getByRole("button", { name: copy("manifest.crewMarkAboard"), exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: warning })).toBeVisible();
  await expect(crew).toContainText(copy("shared.offlineManifest.single.statePendingSuffix"));
  await crew.getByRole("button", { name: copy("manifest.crewAboardCheckAriaLabel") }).click();
  await expect(page.getByText(warning)).toHaveCount(0);
  await context.setOffline(false);
});

test("an unsailed boat change refreshes the log while a historical hull mismatch keeps its evidence", async ({
  page,
  request,
  privateShop,
}) => {
  // Private-shop setup, two distinct departure records and the real details save.
  test.setTimeout(45_000);
  const state = await seed(request, privateShop.slug, "boat");
  const trip = `/shop/${privateShop.slug}/trips/${state.tripId}`;
  await page.goto(`${trip}/log`);
  const section = page.locator("section", {
    has: page.getByRole("heading", { name: copy("incidentExport.boatHeading"), exact: true }),
  });
  await expect(section.getByText("TRUST1", { exact: true })).toBeVisible();
  await page.goto(`${trip}?view=details`);
  const boatAndCrew = await openTripAboutRow(page, copy("trips.about.boatAndCrew"));
  const boatEditor = boatAndCrew.locator("details").filter({
    has: page.getByText(copy("trips.details.editBoat"), { exact: true }),
  });
  await openIfClosed(boatEditor);
  await boatEditor
    .getByLabel(copy("boats.boatSelectLabel"), { exact: false })
    .selectOption(state.replacementBoatId);
  await boatEditor
    .getByRole("button", { name: copy("trips.details.saveChanges"), exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: copy("trips.notices.saved") }),
  ).toBeVisible();
  await page.goto(`${trip}/log`);
  await expect(section.getByText("TRUST2", { exact: true })).toBeVisible();
  await expect(section.getByText("TRUST1", { exact: true })).toHaveCount(0);
  const historic = await seed(request, privateShop.slug, "historic");
  await page.goto(`/shop/${privateShop.slug}/trips/${historic.tripId}/log`);
  await expect(section.getByRole("status")).toHaveText(
    copy("incidentExport.boatChanged", { boatName: "Trust I" }),
  );
  await expect(section.getByText("TRUST1", { exact: true })).toBeVisible();
});

test("a manual junior team retains blocked readiness and ashore advice clears when all stay ashore or re-pair", async ({
  page,
  request,
  privateShop,
}) => {
  // Private-shop setup, explicit team formation, four dock marks and a deliberate re-pair.
  test.setTimeout(60_000);
  const state = await seed(request, privateShop.slug, "buddy");
  await page.goto(`/shop/${privateShop.slug}/trips/${state.tripId}/manifest`);
  await page.getByRole("heading", { name: copy("manifest.buddyHeading") }).click();
  const builder = page.locator('details:has(> form input[name="members"])');
  await openIfClosed(builder);
  await page.getByRole("checkbox", { name: "Ari Vale", exact: true }).check();
  await page.getByRole("checkbox", { name: "Bea Quill", exact: true }).check();
  await page.getByRole("button", { name: copy("manifest.buddyFormSubmit"), exact: true }).click();
  await expect(page).toHaveURL(/buddies=open/);
  await expect(
    page.getByText(
      copy("manifest.buddyTeamCaution", {
        reason: copy("manifest.buddyPartyLeftReason.young_child"),
      }),
    ),
  ).toBeVisible();
  await expect(page.getByText(copy("manifest.buddyTeamNotCleared"))).toBeVisible();
  const junior = manifestRow(page, "Ari Vale");
  const adult = manifestRow(page, "Bea Quill");
  await expect(junior.getByRole("button", { name: "Mark boarded", exact: true })).toHaveCount(0);
  await adult.getByRole("button", { name: "Mark boarded", exact: true }).click();
  await expect(
    adult.getByRole("button", { name: copy("manifest.boardedCheckAriaLabel") }),
  ).toBeVisible();
  await openManifestPerson(junior);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: copy("manifest.markNotBoarded"), exact: true })
    .click();
  const ashore = copy("shared.buddyTeam.ashoreNamed", { name: "Ari" });
  await page.getByRole("dialog").getByRole("button", { name: "Close person details" }).click();
  await expect(adult.getByText(ashore, { exact: true })).toBeVisible();
  await openManifestPerson(adult);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: copy("manifest.markNotBoarded"), exact: true })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Close person details" }).click();
  await expect(page.getByText(ashore, { exact: true })).toHaveCount(0);
  await adult.getByRole("button", { name: copy("manifest.markBoarded"), exact: true }).click();
  await expect(adult.getByText(ashore, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: copy("manifest.buddyDissolve"), exact: true }).click();
  await expect(page.getByText(ashore, { exact: true })).toHaveCount(0);
  await openIfClosed(builder);
  await page.getByRole("checkbox", { name: "Bea Quill", exact: true }).check();
  await page.getByRole("checkbox", { name: state.crewName, exact: false }).check();
  await page.getByRole("button", { name: copy("manifest.buddyFormSubmit"), exact: true }).click();
  await expect(page).toHaveURL(/buddies=open/);
  await expect(
    page.locator("li[data-buddy-member]").filter({ hasText: state.crewName }),
  ).toBeVisible();
  await expect(page.getByText(ashore, { exact: true })).toHaveCount(0);
});

test("an intro team's caution informs and a recorded nonreturn outranks a carried ashore mark", async ({
  page,
  request,
  privateShop,
}) => {
  // Two bounded synthetic departures: a formed intro team and two after-dive physical counts.
  test.setTimeout(45_000);
  const intro = await seed(request, privateShop.slug, "intro");
  await page.goto(`/shop/${privateShop.slug}/trips/${intro.tripId}/manifest`);
  await expect(
    page.getByText(
      copy("manifest.buddyTeamCaution", {
        reason: copy("manifest.buddyPartyLeftReason.intro_course"),
      }),
    ),
  ).toBeVisible();
  const buddyPanel = page
    .locator("details")
    .filter({ has: page.getByRole("heading", { name: copy("manifest.buddyHeading") }) })
    .first();
  await openIfClosed(buddyPanel);
  await expect(
    page.getByRole("button", { name: copy("manifest.buddyDissolve"), exact: true }),
  ).toBeEnabled();
  const state = await seed(request, privateShop.slug, "ashore");
  await page.goto(
    `/shop/${privateShop.slug}/trips/${state.tripId}/manifest?checkpoint=after_dive_1`,
  );
  const adult = manifestRow(page, "Bea Quill");
  await adult.getByRole("button", { name: "Mark boarded", exact: true }).click();
  await expect(
    adult.getByRole("button", { name: copy("manifest.boardedCheckAriaLabel") }),
  ).toBeVisible();
  const ashore = copy("shared.buddyTeam.ashoreNamed", { name: "Ari" });
  await expect(adult.getByText(ashore, { exact: true })).toBeVisible();
  await openManifestPerson(manifestRow(page, "Ari Vale"));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark not back aboard", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Not back aboard", exact: true }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close person details" }).click();
  await expect(adult.getByText("Ari not back aboard", { exact: true })).toBeVisible();
  await expect(adult.getByText(ashore, { exact: true })).toHaveCount(0);
});
