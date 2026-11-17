import type { APIRequestContext, Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { OFFLINE_MANIFEST_SHELL_VERSION } from "../src/lib/offline-manifests";
import type {
  OperationalState,
  seedOperationalTrust,
} from "../src/test/shop-facts/operational-trust";
import { expect, test } from "./fixtures";
import {
  manifestRow,
  offlineCopySaved,
  openDeckDetails,
  openDeckPerson,
  openIfClosed,
  openManifestPerson,
  openOnThisPhone,
  openTripAboutRow,
} from "./helpers";
import { seedFacts } from "./shop-facts";

const copy = staffTranslator("en-US");
type State = Awaited<ReturnType<typeof seedOperationalTrust>>;

async function seed(
  request: APIRequestContext,
  slug: string,
  state: OperationalState,
): Promise<State> {
  const { operationalTrust } = await seedFacts(request, [{ name: "operationalTrust", state }], {
    slug,
  });
  return operationalTrust;
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
  await expect(
    page.getByRole("heading", { name: copy("manifest.deck.title"), exact: true }),
  ).toBeVisible();
  await openDeckPerson(page, "Ari Vale");
}

async function openBuddyPanel(page: Page, trip: string) {
  await page.goto(`${trip}?view=edit&buddies=open`);
  const panel = page
    .locator("details")
    .filter({
      has: page.getByRole("heading", { name: copy("manifest.buddyHeading"), exact: true }),
    })
    .first();
  await openIfClosed(panel);
  return panel;
}

async function openBuddyBuilder(page: Page, trip: string) {
  const panel = await openBuddyPanel(page, trip);
  const builder = panel.locator('details:has(> form input[name="members"])');
  await openIfClosed(builder);
}

async function openBuddyReference(page: Page, name: string) {
  await openManifestPerson(await manifestRow(page, name));
  return page.getByRole("dialog");
}

async function expectReceipt(
  page: Page,
  name: string,
  status: "savedAboard" | "savedAshore" | "savedMissing",
) {
  const receipt = page.locator('[data-deck-screen="receipt"]');
  await expect(receipt.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(receipt.getByText(copy(`manifest.deck.${status}`), { exact: true })).toBeVisible();
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
  await openDeckDetails(page);
  await expect(
    page.getByText(copy("manifest.passengerSnorkelers", { count: 1 }), { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(copy("manifest.passengerRiders", { count: 1 }), { exact: false }),
  ).toBeVisible();
  await context.setOffline(true);
  await openDeckPerson(page, state.crewName);
  await page
    .getByRole("button", {
      name: copy("manifest.deck.record", { name: state.crewName }),
      exact: true,
    })
    .click();
  const receipt = page.locator('[data-deck-screen="receipt"]');
  await expect(receipt.getByRole("heading", { name: state.crewName, exact: true })).toBeVisible();
  await expect(receipt.getByText(copy("manifest.deck.savedAboard"), { exact: true })).toBeVisible();
  await expect(
    receipt.getByText(copy("manifest.deck.pendingReceipt"), { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: warning })).toBeVisible();
  await receipt
    .getByRole("button", {
      name: copy("manifest.deck.undo", { name: state.crewName }),
      exact: true,
    })
    .click();
  await expect(
    page
      .locator('[data-deck-screen="person"]')
      .getByRole("heading", { name: state.crewName, exact: true }),
  ).toBeVisible();
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
  await page.goto(`${trip}?view=edit`);
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
  const trip = `/shop/${privateShop.slug}/trips/${state.tripId}`;
  await openBuddyBuilder(page, trip);
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
  await page.goto(`${trip}/manifest`);
  await openDeckPerson(page, "Ari Vale");
  await expect(
    page.getByRole("button", {
      name: copy("manifest.deck.record", { name: "Ari Vale" }),
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    (await manifestRow(page, "Ari Vale")).getByRole("button", {
      name: "Mark boarded",
      exact: true,
    }),
  ).toHaveCount(0);
  await openDeckPerson(page, "Bea Quill");
  await page
    .getByRole("button", { name: copy("manifest.deck.record", { name: "Bea Quill" }), exact: true })
    .click();
  await expectReceipt(page, "Bea Quill", "savedAboard");
  await (await openBuddyReference(page, "Ari Vale"))
    .getByRole("button", { name: copy("manifest.markNotBoarded"), exact: true })
    .click();
  await expectReceipt(page, "Ari Vale", "savedAshore");
  const ashore = copy("shared.buddyTeam.ashoreNamed", { name: "Ari" });
  let adult = await manifestRow(page, "Bea Quill");
  await expect(adult.getByText(ashore, { exact: true })).toBeVisible();
  await (await openBuddyReference(page, "Bea Quill"))
    .getByRole("button", { name: copy("manifest.markNotBoarded"), exact: true })
    .click();
  await expectReceipt(page, "Bea Quill", "savedAshore");
  adult = await manifestRow(page, "Bea Quill");
  await expect(adult.getByText(ashore, { exact: true })).toHaveCount(0);
  await openDeckPerson(page, "Bea Quill");
  await page
    .getByRole("button", { name: copy("manifest.deck.record", { name: "Bea Quill" }), exact: true })
    .click();
  await expectReceipt(page, "Bea Quill", "savedAboard");
  adult = await manifestRow(page, "Bea Quill");
  await expect(adult.getByText(ashore, { exact: true })).toBeVisible();
  await openBuddyPanel(page, trip);
  await page.getByRole("button", { name: copy("manifest.buddyDissolve"), exact: true }).click();
  await expect(page).toHaveURL(/buddies=open/);
  await expect(page.locator("li[data-buddy-member]").filter({ hasText: "Ari Vale" })).toHaveCount(
    0,
  );
  await page.goto(`${trip}/manifest`);
  adult = await manifestRow(page, "Bea Quill");
  await expect(adult.getByText(ashore, { exact: true })).toHaveCount(0);
  await openBuddyBuilder(page, trip);
  await page.getByRole("checkbox", { name: "Bea Quill", exact: true }).check();
  await page.getByRole("checkbox", { name: state.crewName, exact: false }).check();
  await page.getByRole("button", { name: copy("manifest.buddyFormSubmit"), exact: true }).click();
  await expect(page).toHaveURL(/buddies=open/);
  await expect(
    page.locator("li[data-buddy-member]").filter({ hasText: state.crewName }),
  ).toBeVisible();
  await page.goto(`${trip}/manifest`);
  adult = await manifestRow(page, "Bea Quill");
  const buddyReference = await openBuddyReference(page, "Bea Quill");
  await expect(
    buddyReference.getByRole("region", { name: copy("manifest.personSheetBuddyTeam") }),
  ).toContainText(state.crewName);
  adult = await manifestRow(page, "Bea Quill");
  await expect(adult.getByText(ashore, { exact: true })).toHaveCount(0);
});

test("an intro team's caution informs and a recorded nonreturn outranks a carried ashore mark", async ({
  page,
  request,
  privateShop,
}) => {
  // Two bounded synthetic departures: a formed intro team and two after-dive physical counts.
  test.setTimeout(45_000);
  const intro = await seed(request, privateShop.slug, "intro");
  await openBuddyPanel(page, `/shop/${privateShop.slug}/trips/${intro.tripId}`);
  await expect(
    page.getByText(
      copy("manifest.buddyTeamCaution", {
        reason: copy("manifest.buddyPartyLeftReason.intro_course"),
      }),
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: copy("manifest.buddyDissolve"), exact: true }),
  ).toBeEnabled();
  const state = await seed(request, privateShop.slug, "ashore");
  await page.goto(
    `/shop/${privateShop.slug}/trips/${state.tripId}/manifest?checkpoint=after_dive_1`,
  );
  await openDeckPerson(page, "Bea Quill");
  await page
    .getByRole("button", { name: copy("manifest.deck.record", { name: "Bea Quill" }), exact: true })
    .click();
  await expectReceipt(page, "Bea Quill", "savedAboard");
  const ashore = copy("shared.buddyTeam.ashoreNamed", { name: "Ari" });
  let adult = await manifestRow(page, "Bea Quill");
  await expect(adult.getByText(ashore, { exact: true })).toBeVisible();
  await (await openBuddyReference(page, "Ari Vale"))
    .getByRole("button", { name: "Mark not back aboard", exact: true })
    .click();
  await expectReceipt(page, "Ari Vale", "savedMissing");
  adult = await manifestRow(page, "Bea Quill");
  await expect(adult.getByText("Ari not back aboard", { exact: true })).toBeVisible();
  await expect(adult.getByText(ashore, { exact: true })).toHaveCount(0);
});
