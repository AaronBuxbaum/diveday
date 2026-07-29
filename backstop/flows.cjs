const { createHmac } = require("node:crypto");
const path = require("node:path");

const SHOP = "blue-mantis";
const REEF_TRIP = "Two-Tank Reef — Molasses & French";
const NIGHT_TRIP = "Night Dive — City of Washington";

function baseURL() {
  return process.env.BACKSTOP_BASE_URL || "http://127.0.0.1:3200";
}

async function go(page, pathname) {
  const url = pathname.startsWith("http") ? pathname : `${baseURL()}${pathname}`;
  await page.goto(url, { waitUntil: "networkidle" });
}

async function ready(_page, locator) {
  await locator.waitFor({ state: "visible", timeout: 60_000 });
}

async function fonts(page) {
  await page.evaluate(() => document.fonts.ready);
}

async function withOwnerPage(browserContext, callback) {
  const browser = browserContext.browser();
  if (!browser) throw new Error("Backstop owner setup requires a live browser");
  const context = await browser.newContext({
    baseURL: baseURL(),
    storageState: path.resolve("backstop_data/.owner-storage-state.json"),
  });
  try {
    const page = await context.newPage();
    return await callback(page);
  } finally {
    await context.close();
  }
}

async function openTrip(page, title = REEF_TRIP, tab) {
  await go(page, `/shop/${SHOP}/schedule`);
  await page.locator("li").filter({ hasText: title }).getByRole("link").click();
  await page.waitForURL(/\/shop\/blue-mantis\/trips\//);

  if (tab) {
    await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: tab }).click();
    await page.waitForURL(new RegExp(`/${tab.toLowerCase()}`));
  }
}

function recapToken() {
  const bookingId = "0de3c0de-1eaf-4b0a-9c0f-000000000001";
  const secret = process.env.AUTH_SECRET || "diveday-e2e-secret";
  const payload = Buffer.from(`recap:${bookingId}`, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function simple(page) {
  await page.waitForLoadState("networkidle");
}

async function siteBriefing(page) {
  await openTrip(page);
  await ready(page, page.getByTitle("Satellite map of Molasses Reef"));
}

async function recap(page, _scenario, _viewport, browserContext) {
  await withOwnerPage(browserContext, async (ownerPage) => {
    await go(ownerPage, `/shop/${SHOP}/settings`);
    await ownerPage.getByLabel("Review link").fill("https://g.page/r/blue-mantis/review");
    await ownerPage.getByRole("button", { name: "Save review link" }).click();
    await ready(ownerPage, ownerPage.getByText("Review link saved."));
  });
  await page.request.post(`${baseURL()}/api/test/seed-stripe-account`);
  await go(page, `/recap/${recapToken()}`);
  await ready(page, page.getByRole("heading", { name: /Nice diving/ }));
  await ready(page, page.getByRole("heading", { name: "Tip your crew" }));
}

async function waiverActive(page, _scenario, _viewport, browserContext) {
  const waiverHref = await withOwnerPage(browserContext, async (ownerPage) => {
    await openTrip(ownerPage, REEF_TRIP, "Guests");
    const diverSection = ownerPage
      .locator("section")
      .filter({ has: ownerPage.getByRole("heading", { name: /^Divers/ }) });
    await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
    await ready(ownerPage, ownerPage.getByRole("heading", { name: "Private waiver link ready" }));
    return ownerPage.getByRole("link", { name: "Open waiver link" }).getAttribute("href");
  });
  await go(page, waiverHref || "/");
  await ready(page, page.getByRole("heading", { name: "A quick step before the dock" }));
}

async function readiness(page, scenario) {
  await openTrip(page);
  await ready(page, page.getByLabel("Number of divers"));
  await page.getByLabel("Number of divers").waitFor({ state: "attached" });
  await page.getByLabel("Number of divers").waitFor({ state: "visible" });
  await page.getByLabel("Name", { exact: true }).fill("Visual Regression Diver");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`visual-regression-${scenario.scheme}@example.com`);
  await page.getByRole("button", { name: /^Book/ }).click();
  await ready(page, page.getByRole("heading", { name: /You're on the boat/ }));
  const readinessHref = await page
    .getByRole("link", { name: /readiness page/ })
    .getAttribute("href");
  await go(page, readinessHref || "/");
  await ready(page, page.getByRole("heading", { name: "Your pre-trip checklist" }));
}

async function diverProfile(page, name, initials) {
  await go(page, `/shop/${SHOP}/divers`);
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByText(initials, { exact: true })
    .click();
  await ready(page, page.getByRole("heading", { level: 1, name }));
}

async function today(page) {
  await go(page, `/shop/${SHOP}`);
  await ready(
    page,
    page.getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ }),
  );
}

async function divers(page) {
  await go(page, `/shop/${SHOP}/divers`);
}

async function checkIn(page) {
  await go(page, `/shop/${SHOP}/check-in`);
  await ready(page, page.getByRole("heading", { name: "Line-busting check-in" }));
  await ready(page, page.getByRole("region", { name: "Check-in queue" }));
}

async function staffTrip(page, tab) {
  await openTrip(page, REEF_TRIP, tab);
  await ready(page, page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }));
}

async function manifest(page) {
  await staffTrip(page, "Manifest");
  await ready(page, page.getByRole("link", { name: "Open offline roll call" }));
}

async function prep(page) {
  await staffTrip(page, "Prep");
  await ready(page, page.getByRole("heading", { name: "Tanks" }));
}

async function offlineManifestList(page) {
  await manifest(page);
  await go(page, "/offline-manifest");
  await ready(page, page.getByRole("heading", { name: "Saved on this device" }));
}

async function offlineManifestEmpty(page) {
  await manifest(page);
  const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\//)?.[1];
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("diveday-offline-manifests");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error("failed to clear IndexedDB"));
      }),
  );
  await go(page, `/offline-manifest?trip=${tripId}`);
  await ready(page, page.getByRole("heading", { name: "Nothing saved on this phone yet" }));
}

async function identityGate(page) {
  await openTrip(page, NIGHT_TRIP, "Guests");
  await ready(page, page.getByText("Identity unconfirmed").first());
}

async function prepNoNitrox(page) {
  try {
    await go(page, `/shop/${SHOP}/settings`);
    await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
    await page.getByRole("button", { name: "Save rental catalog" }).click();
    await ready(page, page.getByText("Rental catalog saved."));
    await prep(page);
  } finally {
    await go(page, `/shop/${SHOP}/settings`);
    await page.getByRole("checkbox", { name: "Nitrox fills" }).check();
    await page.getByRole("button", { name: "Save rental catalog" }).click();
    await ready(page, page.getByText("Rental catalog saved."));
  }
}

async function printDock(page, flow) {
  await openTrip(page);
  const tripPath = new URL(page.url()).pathname;
  await go(page, `${tripPath}/${flow}`);
  await page.emulateMedia({ media: "print" });
  if (flow === "manifest") {
    await ready(page, page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }));
  } else {
    await ready(page, page.getByRole("heading", { name: "Tanks" }));
  }
}

const flows = {
  landing: simple,
  product: simple,
  pricing: simple,
  "sign-in": simple,
  "forgot-password": simple,
  "verify-invalid": simple,
  "reset-password-invalid": simple,
  schedule: simple,
  "schedule-embed": simple,
  "course-page": simple,
  "switching-hub": simple,
  "switching-eve": simple,
  "switching-spreadsheet": simple,
  "switching-fareharbor": simple,
  "switching-rezdy": simple,
  about: simple,
  "site-briefing": siteBriefing,
  recap,
  "waiver-active": waiverActive,
  readiness,
  today,
  "check-in": checkIn,
  divers,
  "diver-profile": (page) => diverProfile(page, "Priya Sharma", "PS"),
  "diver-profile-expired": (page) => diverProfile(page, "Yusuf Demir", "YD"),
  "diver-profile-imported": (page) => diverProfile(page, "Hana Kobayashi", "HK"),
  "trip-manage": (page) => staffTrip(page),
  "trip-guests": (page) => staffTrip(page, "Guests"),
  manifest,
  prep,
  "offline-manifest-list": offlineManifestList,
  "offline-manifest-empty": offlineManifestEmpty,
  "settings-payments": simple,
  "settings-export": simple,
  "settings-import": simple,
  "settings-embed": simple,
  "settings-team": simple,
  reports: simple,
  "trip-guests-identity": identityGate,
  "prep-no-nitrox": prepNoNitrox,
  "manifest-print": (page) => printDock(page, "manifest"),
  "prep-print": (page) => printDock(page, "prep"),
};

module.exports = { flows, fonts };
