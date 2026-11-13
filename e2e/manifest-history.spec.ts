import { readManifestHistoryCookie } from "../src/app/shop/[shopSlug]/trips/[id]/manifest/_components/manifest-history-cookie";
import { DEMO_TODAY_TRIP_ID } from "../src/db/seed-identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { manifestRow } from "./helpers";

signedInAsOwner();

type ReadShape = { rscKey: number; prefetch: boolean; segmentPrefetch: boolean; nextUrl: boolean };
type ReadCounts = {
  total: number;
  previous: number;
  newChallenge: number;
  distinctNew: number;
  shapes: ReadShape[];
};

function readShape(url: URL, headers: Record<string, string>, keys: string[]): ReadShape {
  const key = url.searchParams.get("_rsc") ?? "";
  if (!keys.includes(key)) keys.push(key);
  return {
    rscKey: keys.indexOf(key) + 1,
    prefetch: Boolean(headers["next-router-prefetch"]),
    segmentPrefetch: Boolean(headers["next-router-segment-prefetch"]),
    nextUrl: Boolean(headers["next-url"]),
  };
}

async function expectOneRead(counts: ReadCounts) {
  try {
    await expect.poll(() => counts.total).toBe(1);
  } catch (error) {
    throw new Error(`Manifest RSC request counts: ${JSON.stringify(counts)}`, { cause: error });
  }
}

for (const width of [390, 1280]) {
  for (const direction of ["back", "forward"] as const) {
    test(`${direction} keeps the cached manifest until the server confirms it at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
      const manifest = `${trip}/manifest`;
      const tripTab = page
        .locator(`nav[data-trip-tabs] a[href="${trip}"]`)
        .filter({ visible: true });
      const manifestTab = page
        .locator(`nav[data-trip-tabs] a[href="${manifest}"]`)
        .filter({ visible: true });
      const copy = staffTranslator("en-US");
      if (direction === "forward") {
        await page.goto(trip);
        await manifestTab.click();
      } else {
        await page.goto(manifest);
      }
      await expect(manifestRow(page, "Priya Sharma")).toBeVisible();
      await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
      if (direction === "forward") await page.goBack();
      else await tripTab.click();
      await expect(tripTab).toHaveAttribute("aria-current", "page");

      const previousToken = readManifestHistoryCookie(
        await page.evaluate(() => document.cookie),
        DEMO_TODAY_TRIP_ID,
      );
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requests: ReadCounts = {
        total: 0,
        previous: 0,
        newChallenge: 0,
        distinctNew: 0,
        shapes: [],
      };
      const newTokens = new Set<string>();
      const rscKeys: string[] = [];
      await page.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const token =
          url.pathname === manifest && request.headers().rsc === "1"
            ? readManifestHistoryCookie(
                (await request.allHeaders()).cookie ?? null,
                DEMO_TODAY_TRIP_ID,
              )
            : undefined;
        if (token) {
          requests.total += 1;
          requests.shapes.push(readShape(url, request.headers(), rscKeys));
          if (token === previousToken) requests.previous += 1;
          else {
            requests.newChallenge += 1;
            newTokens.add(token);
            requests.distinctNew = newTokens.size;
          }
          await held;
          await route.continue();
          return;
        }
        await route.fallback();
      });
      try {
        if (direction === "forward") await page.goForward();
        else await page.goBack();
        await expectOneRead(requests);
        await expect(manifestRow(page, "Priya Sharma")).toBeVisible();
        await expect(
          page.getByText(copy("manifest.rosterUnconfirmed"), { exact: true }),
        ).toBeVisible();
      } finally {
        release();
      }
      await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
      expect(requests.total).toBe(1);
    });
  }
}

test("a roster refresh preserves an open person sheet without a document navigation", async ({
  page,
}) => {
  const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
  const manifest = `${trip}/manifest`;
  const copy = staffTranslator("en-US");
  await page.goto(manifest);
  await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
  const tripTab = page.locator(`nav[data-trip-tabs] a[href="${trip}"]`).filter({ visible: true });
  await tripTab.click();
  await expect(tripTab).toHaveAttribute("aria-current", "page");

  const previousToken = readManifestHistoryCookie(
    await page.evaluate(() => document.cookie),
    DEMO_TODAY_TRIP_ID,
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads: ReadCounts = { total: 0, previous: 0, newChallenge: 0, distinctNew: 0, shapes: [] };
  const newTokens = new Set<string>();
  const rscKeys: string[] = [];
  let documentNavigations = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentNavigations++;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const token =
      url.pathname === manifest && request.headers().rsc === "1"
        ? readManifestHistoryCookie((await request.allHeaders()).cookie ?? null, DEMO_TODAY_TRIP_ID)
        : undefined;
    if (token) {
      reads.total += 1;
      reads.shapes.push(readShape(url, request.headers(), rscKeys));
      if (token === previousToken) reads.previous += 1;
      else {
        reads.newChallenge += 1;
        newTokens.add(token);
        reads.distinctNew = newTokens.size;
      }
      await held;
      await route.continue();
      return;
    }
    await route.fallback();
  });
  try {
    await page.goBack();
    await expectOneRead(reads);
    const trigger = manifestRow(page, "Priya Sharma").locator('button[aria-haspopup="dialog"]');
    await expect(trigger).toHaveAttribute("data-hydrated", "true");
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
  expect(documentNavigations).toBe(0);
});

test("a superseded snapshot and roster refresh preserve an open person sheet", async ({ page }) => {
  const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
  const manifest = `${trip}/manifest`;
  const copy = staffTranslator("en-US");
  let releaseClaim!: () => void;
  let releaseRead!: () => void;
  const claimHeld = new Promise<void>((resolve) => {
    releaseClaim = resolve;
  });
  const readHeld = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let claims = 0;
  let staleResponses = 0;
  let reads = 0;
  let holdReturnRead = false;
  let documentNavigations = 0;
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname.endsWith(
        `/offline-manifests/${DEMO_TODAY_TRIP_ID}/snapshot`,
      ) &&
      response.status() === 409
    )
      staleResponses++;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith(`/offline-manifests/${DEMO_TODAY_TRIP_ID}/snapshot`)) {
      claims++;
      if (claims === 1) {
        await claimHeld;
        await route.fulfill({ status: 409, json: { error: "snapshot_superseded" } });
        return;
      }
    }
    if (
      url.pathname === manifest &&
      request.headers().rsc === "1" &&
      readManifestHistoryCookie((await request.allHeaders()).cookie ?? null, DEMO_TODAY_TRIP_ID) &&
      holdReturnRead
    ) {
      reads++;
      if (reads === 1) await readHeld;
    }
    await route.fallback();
  });
  try {
    await page.goto(manifest);
    await expect.poll(() => claims).toBeGreaterThanOrEqual(1);
    await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
    const tripTab = page.locator(`nav[data-trip-tabs] a[href="${trip}"]`).filter({ visible: true });
    await tripTab.click();
    await expect(tripTab).toHaveAttribute("aria-current", "page");
    holdReturnRead = true;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documentNavigations++;
    });
    await page.goBack();
    await expect.poll(() => reads).toBeGreaterThanOrEqual(1);
    const trigger = manifestRow(page, "Priya Sharma").locator('button[aria-haspopup="dialog"]');
    await expect(trigger).toHaveAttribute("data-hydrated", "true");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Priya Sharma", exact: true });
    await expect(dialog).toBeVisible();
    releaseClaim();
    releaseRead();
    await expect.poll(() => staleResponses).toBe(1);
    await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
    expect(documentNavigations).toBe(0);
    await expect(dialog).toBeVisible();
  } finally {
    releaseClaim();
    releaseRead();
  }
});

test("a person sheet survives a held roster read alongside route prefetch", async ({ page }) => {
  const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
  const manifest = `${trip}/manifest`;
  const copy = staffTranslator("en-US");
  await page.goto(manifest);
  await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
  const tripTab = page.locator(`nav[data-trip-tabs] a[href="${trip}"]`).filter({ visible: true });
  await tripTab.click();
  await expect(tripTab).toHaveAttribute("aria-current", "page");

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  let documentNavigations = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentNavigations++;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const headers = request.headers();
    if (
      new URL(request.url()).pathname === manifest &&
      headers.rsc === "1" &&
      !headers["next-router-prefetch"] &&
      readManifestHistoryCookie((await request.allHeaders()).cookie ?? null, DEMO_TODAY_TRIP_ID)
    ) {
      reads++;
      await held;
      await route.continue();
      return;
    }
    await route.fallback();
  });
  try {
    await page.goBack();
    await expect.poll(() => reads).toBe(1);
    await expect(manifestRow(page, "Priya Sharma")).toBeVisible();
    await expect(page.getByText(copy("manifest.rosterUnconfirmed"), { exact: true })).toBeVisible();
    const trigger = manifestRow(page, "Priya Sharma").locator('button[aria-haspopup="dialog"]');
    await expect(trigger).toHaveAttribute("data-hydrated", "true");
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
  expect(reads).toBe(1);
  expect(documentNavigations).toBe(0);
});

test("a cached return observes one roster read through confirmation with route prefetch", async ({
  page,
}) => {
  const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
  const manifest = `${trip}/manifest`;
  const copy = staffTranslator("en-US");
  const counter = async (action: "reset" | "read" | "clear") => {
    const response = await page.request.post("/api/test/manifest-reads", {
      data: { tripId: DEMO_TODAY_TRIP_ID, action },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()) as { count: number | null };
  };
  await counter("reset");
  try {
    await page.goto(manifest);
    await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
    // This proves the test route and server-rendered page share a counter.
    await expect.poll(async () => (await counter("read")).count).toBeGreaterThan(0);
    const tripTab = page.locator(`nav[data-trip-tabs] a[href="${trip}"]`).filter({ visible: true });
    await tripTab.click();
    await expect(tripTab).toHaveAttribute("aria-current", "page");
    const previousToken = readManifestHistoryCookie(
      await page.evaluate(() => document.cookie),
      DEMO_TODAY_TRIP_ID,
    );
    await counter("reset");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshRequests = 0;
    let prefetchRequests = 0;
    let prefetchCompleted = 0;
    let prefetchContainsRoster = false;
    const refreshTokens: string[] = [];
    let documentNavigations = 0;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documentNavigations++;
    });
    const shapes: ReadShape[] = [];
    const keys: string[] = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === manifest && request.headers().rsc === "1") {
        const shape = readShape(url, request.headers(), keys);
        shapes.push(shape);
        if (!shape.prefetch && !shape.segmentPrefetch) {
          refreshRequests++;
          const token = readManifestHistoryCookie(
            (await request.allHeaders()).cookie ?? null,
            DEMO_TODAY_TRIP_ID,
          );
          refreshTokens.push(token ?? "");
          await held;
          await route.continue();
          return;
        }
        prefetchRequests++;
        const response = await route.fetch();
        const body = await response.body();
        const text = body.toString("utf8");
        if (text.includes("Priya Sharma") || text.includes("renderProof"))
          prefetchContainsRoster = true;
        await route.fulfill({ response, body });
        prefetchCompleted++;
        return;
      }
      await route.fallback();
    });
    try {
      await page.goBack();
      await expect.poll(() => refreshRequests).toBe(1);
      await expect.poll(() => prefetchCompleted).toBeGreaterThan(0);
      expect(prefetchContainsRoster).toBe(false);
      expect(refreshTokens).toHaveLength(1);
      expect(refreshTokens[0]).toBeTruthy();
      expect(refreshTokens[0]).not.toBe(previousToken);
      await expect(manifestRow(page, "Priya Sharma")).toBeVisible();
      await expect(
        page.getByText(copy("manifest.rosterUnconfirmed"), { exact: true }),
      ).toBeVisible();
      expect(
        await counter("read"),
        `server reads before refresh release: ${JSON.stringify(shapes)}`,
      ).toEqual({ count: 0 });
      const trigger = manifestRow(page, "Priya Sharma").locator('button[aria-haspopup="dialog"]');
      await expect(trigger).toHaveAttribute("data-hydrated", "true");
      await trigger.click();
      await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
    } finally {
      release();
    }
    await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
    await expect.poll(() => prefetchRequests - prefetchCompleted).toBe(0);
    expect(refreshRequests, JSON.stringify(shapes)).toBe(1);
    expect(documentNavigations).toBe(0);
    expect(
      await counter("read"),
      `server reads after confirmation: ${JSON.stringify(shapes)}`,
    ).toEqual({ count: 1 });
  } finally {
    await counter("clear");
  }
});
