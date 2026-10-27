import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { chromiumExecutableOverride, DETERMINISTIC_RENDERING_ARGS } from "./browser";
import { test as base, expect, makeActivitySafe } from "./fixtures";
import { findTripOnBoard, openDiverFileGroup, openTripTab, rosterRow } from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";

/**
 * **The cert-check extension itself, installed in a real Chromium** (H-105, ADR
 * 20261008-cert-check-extension).
 *
 * Every other `agency-check*.spec.ts` stands in for the extension at the
 * `postMessage` seam. This one loads `extension/` unpacked into the browser
 * the test drives, so the manifest, the content script, the bridge, the MV3
 * service worker, the background tab and `fill.js` are all the real ones.
 * Only two things differ from a staffer's Chrome:
 *
 * - **The agencies' pages are ours.** Each agency host the extension opens
 *   (`extension/agencies.js`) is answered by the small page below, shaped like
 *   the real lookup: a form, and a result page echoing what was typed. No test
 *   reaches an agency.
 * - **The content script also matches this server.** The published manifest
 *   runs it on `https://dive.day/shop/*` only (a unit test pins that), so the
 *   copy loaded here adds `http://127.0.0.1/shop/*`, the step
 *   `extension/README.md` gives for trying it against a local server. The
 *   service worker already accepts a loopback DiveDay.
 *
 * Extensions need the full Chromium, not the headless shell the rest of the
 * fleet launches: `pnpm exec playwright install chromium` (CI's
 * `playwright-shell` action does it for the shard dealt this file). Locally:
 * `pnpm e2e:run e2e/agency-check-extension.spec.ts --reporter=line`.
 */

const SHOP = "blue-mantis";
/** A seeded diver on this departure whose SSI card is still pending (`seed-divers.ts`). */
const SEEDED_DIVER = "Tyler Brooks";
const DEPARTURE = /Two-Tank Reef — French Reef/;
const CERTIFIED = "SSI shows this certification. Marked certified.";
const LISTED_LEAD = "SSI also shows these certifications. Add them? Each waits for Mark certified.";

/** What the fake agency pages answer, and what reached them. */
type AgencyPages = {
  /** SSI's result lists nitrox and Deep under the level card. */
  ssiListsMore: boolean;
  /**
   * SSI's lookup as it is, with its boxes renamed past recognising (a
   * redesign), or with reCAPTCHA's box drawn on its form (its frame).
   */
  ssiForm: "as-is" | "renamed" | "captcha";
  /**
   * DiveChek, on pro.padi.com. Signed out: it shows its sign-in form, or sends
   * the tab to PADI's sign-in host. Signed in: it sends the tab on to the same
   * page on pros.padi.com, PADI's other Pros' Site host, which answers with
   * DiveChek's form and its "Run Report" button. Expiring on search: the form
   * shows, and the search is answered with the sign-in form.
   */
  padi: "sign-in-form" | "sign-in-redirect" | "signed-in-on-pros" | "expires-on-search";
  /**
   * Holds SSI's answer to every lookup after the first `after` ones until
   * `open` resolves, so a state that lasts only as long as a lookup (the
   * second card of a "Check all") stays on screen for as long as a test needs.
   */
  ssiHold: { after: number; open: Promise<void> } | null;
  /** The card number DiveChek's result row shows. */
  padiCardNumber: string;
  /** Every request a fake agency page received, as `METHOD url`. */
  requests: string[];
  /** Anything typed into the PADI sign-in form, by box name. */
  typedIntoSignIn: string[];
  /**
   * When each agency request and agency tab event happened, redacted: host, path and the
   * query's keys, never a value (#2878). Attached with the worker's phases when a test fails.
   */
  ledger: [number, string][];
};

/** An agency address with its query's values left out: `GET my.divessi.com/online_diver_check?diver_name&card_number`. */
function redactedAddress(href: string): string {
  try {
    const url = new URL(href);
    const keys = [...url.searchParams.keys()];
    return `${url.host}${url.pathname}${keys.length > 0 ? `?${keys.join("&")}` : ""}`;
  } catch {
    return "(unreadable address)";
  }
}

function html(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? "",
  );
}

/** SSI's public Online Diver Check: name and card number, then the diver's record. */
function ssiPage(url: URL, listsMore: boolean, form: AgencyPages["ssiForm"]): string {
  const name = url.searchParams.get("diver_name");
  const number = url.searchParams.get("card_number");
  if (name === null || number === null) {
    if (form === "renamed") {
      return html(
        "Online Diver Check",
        `<h1>Online Diver Check</h1>
        <form method="get" action="/online_diver_check">
          <label>Taucher <input name="q1"></label>
          <label>Ausweis <input name="q2"></label>
          <button type="submit">Search</button>
        </form>`,
      );
    }
    return html(
      "Online Diver Check",
      `<h1>Online Diver Check</h1>
      <form method="get" action="/online_diver_check">
        <label>Diver name <input name="diver_name"></label>
        <label>Card number <input name="card_number"></label>
        ${form === "captcha" ? '<div class="g-recaptcha"><iframe title="reCAPTCHA" width="304" height="78" src="/recaptcha/api2/anchor?k=stand-in"></iframe></div>' : ""}
        <button type="submit">Search</button>
      </form>`,
    );
  }
  return html(
    "Online Diver Check",
    `<h1>Online Diver Check</h1>
    <p>${escapeHtml(name)}</p>
    <p>Card ${escapeHtml(number)}</p>
    <p>Open Water Diver</p>
    ${listsMore ? "<p>Enriched Air Nitrox · Deep Diving</p>" : ""}`,
  );
}

/**
 * The PADI Pros' Site's sign-in, where DiveChek sends a signed-out staffer.
 * Any box typed into reports itself, so the spec can say nothing was.
 */
const PADI_SIGN_IN = html(
  "Sign in | PADI Pros",
  `<h1>Sign in to the PADI Pros’ Site</h1>
  <form method="post" action="/divechek">
    <label>Email <input type="email" name="email"></label>
    <label>Password <input type="password" name="password"></label>
    <button type="submit">Sign in</button>
  </form>
  <script>
    for (const box of document.querySelectorAll("input")) {
      box.addEventListener("input", () =>
        fetch("/__typed?box=" + encodeURIComponent(box.name), { method: "POST" }),
      );
    }
  </script>`,
);

/**
 * DiveChek signed in: its form, then the one diver's record. PADI's own
 * instructions name the button "Run Report".
 */
function divechekPage(url: URL, cardNumber: string): string {
  const first = url.searchParams.get("first_name");
  const last = url.searchParams.get("last_name");
  const born = url.searchParams.get("dob");
  if (first === null || last === null || born === null) {
    return html(
      "DiveChek | PADI Pros",
      `<h1>DiveChek</h1>
      <form method="get" action="/divechek">
        <label>First Name <input name="first_name"></label>
        <label>Last Name <input name="last_name"></label>
        <label>Date of Birth <input name="dob"></label>
        <button type="submit">Run Report</button>
      </form>`,
    );
  }
  return html(
    "DiveChek | PADI Pros",
    `<h1>DiveChek</h1>
    <p>1 diver found</p>
    <p>${escapeHtml(first)} ${escapeHtml(last)}</p>
    <p>Date of Birth: ${escapeHtml(born)}</p>
    <p>Open Water Diver 06/15/2015 ${escapeHtml(cardNumber)}</p>`,
  );
}

/** The published manifest, read once: what the extension may open is what these pages answer for. */
const publishedManifest = JSON.parse(
  fs.readFileSync(path.resolve(__filename, "..", "..", "extension", "manifest.json"), "utf8"),
) as { version: string; host_permissions: string[] };
/** Every host the extension may open or be sent to (its manifest), and PADI's sign-in host. */
const AGENCY_HOSTS = [
  ...publishedManifest.host_permissions.map((pattern) => new URL(pattern.replace(/\*$/, "")).host),
  "login.padi.com",
];
const PADI_HOSTS = ["pro.padi.com", "pros.padi.com"];
/** The hosts the fake pages below answer; every permitted host must be one, or a test reaches an agency. */
const ANSWERED_HOSTS = new Set([
  "my.divessi.com",
  "www.naui.org",
  "www.tdisdi.com",
  "www.gue.com",
  "portal.cmas.org",
  ...PADI_HOSTS,
  "login.padi.com",
]);

/**
 * The agencies' pages, served over HTTPS on a loopback port that Chromium is
 * told each agency host resolves to (`--host-resolver-rules`).
 *
 * Not `context.route`: a tab the extension opens starts loading before
 * Playwright has attached to it, so its first request escapes interception
 * and goes to the real agency. Resolving the hosts here holds for every
 * request the browser makes, whoever makes it. The certificate is
 * self-signed, minted per test, and accepted with `--ignore-certificate-errors`.
 */
async function serveAgencyPages(pages: AgencyPages, dir: string): Promise<https.Server> {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=agency-fakes",
    ].concat(["-keyout", key, "-out", cert]),
    { stdio: "ignore" },
  );
  const server = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
    async (request, response) => {
      const url = new URL(request.url ?? "/", `https://${request.headers.host}`);
      pages.requests.push(`${request.method} ${url.href}`);
      pages.ledger.push([Date.now(), `agency:${request.method} ${redactedAddress(url.href)}`]);
      const send = (status: number, body = "", headers: Record<string, string> = {}) => {
        response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
        response.end(body);
      };
      if (url.hostname === "my.divessi.com" && url.pathname === "/online_diver_check") {
        const lookups = pages.requests.filter((each) => each.includes("diver_name=")).length;
        if (url.search.includes("diver_name=") && pages.ssiHold && lookups > pages.ssiHold.after) {
          pages.ledger.push([Date.now(), `agency:held lookup ${lookups}`]);
          await pages.ssiHold.open;
          pages.ledger.push([Date.now(), `agency:released lookup ${lookups}`]);
        }
        return send(200, ssiPage(url, pages.ssiListsMore, pages.ssiForm));
      }
      if (PADI_HOSTS.includes(url.hostname) && url.pathname === "/__typed") {
        pages.typedIntoSignIn.push(url.searchParams.get("box") ?? "?");
        return send(204);
      }
      if (url.hostname === "pro.padi.com" && url.pathname === "/divechek") {
        if (pages.padi === "signed-in-on-pros" || pages.padi === "expires-on-search") {
          return send(302, "", { location: "https://pros.padi.com/divechek" });
        }
        return pages.padi === "sign-in-redirect"
          ? send(302, "", { location: "https://login.padi.com/sign-in?return=%2Fdivechek" })
          : send(200, PADI_SIGN_IN);
      }
      if (url.hostname === "pros.padi.com" && url.pathname === "/divechek") {
        if (pages.padi === "expires-on-search") {
          return url.search === ""
            ? send(200, divechekPage(url, pages.padiCardNumber))
            : send(200, PADI_SIGN_IN);
        }
        return pages.padi === "signed-in-on-pros"
          ? send(200, divechekPage(url, pages.padiCardNumber))
          : send(200, PADI_SIGN_IN);
      }
      if (url.hostname === "login.padi.com") return send(200, PADI_SIGN_IN);
      return send(404, html("Not found", "<h1>Not found</h1>"));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

/**
 * `extension/` copied with one change, the content script's match for this
 * loopback server, so the published manifest stays as it is.
 */
function stageExtension(sourceDir: string, targetDir: string): string {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  const manifestPath = path.join(targetDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    content_scripts: { matches: string[] }[];
  };
  for (const script of manifest.content_scripts) script.matches.push("http://127.0.0.1/shop/*");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return targetDir;
}

/**
 * The full Chromium an extension needs; the fleet's headless shell cannot load one.
 *
 * Branded Google Chrome ignores `--load-extension`, so when the pinned Chromium
 * is missing and `chromiumExecutableOverride()` falls back to the system Chrome,
 * every test here would die with "browser has been closed" (a Playwright bump
 * on 2026-10-15 left a Mac on an older build and did exactly that). Refuse it
 * by name instead.
 */
function extensionCapableChromium(): string | undefined {
  const override = chromiumExecutableOverride();
  if (override?.includes("Google Chrome.app")) {
    throw new Error(
      `agency-check-extension.spec.ts loads the real extension, and the fallback browser ${override} ` +
        `is branded Google Chrome, which ignores --load-extension. Install the pinned Chromium: ` +
        `\`pnpm exec playwright install chromium\`.`,
    );
  }
  if (override) return override;
  const bundled = chromium.executablePath();
  if (fs.existsSync(bundled)) return undefined;
  throw new Error(
    `agency-check-extension.spec.ts loads the real extension, which needs the full Chromium, not ` +
      `the headless shell. Not found at ${bundled}. Run \`pnpm exec playwright install chromium\`.`,
  );
}

const test = base.extend<{ agencyPages: AgencyPages; extensionId: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring pattern.
  agencyPages: async ({}, use) => {
    await use({
      ssiListsMore: false,
      ssiForm: "as-is",
      ssiHold: null,
      padi: "sign-in-form",
      padiCardNumber: "",
      requests: [],
      typedIntoSignIn: [],
      ledger: [],
    });
  },

  // A persistent context, the only kind Chromium loads an unpacked extension
  // into, signed in as the seeded owner and on the fleet's frozen clock.
  context: async ({ workerBaseURL, staffStorageState, agencyPages }, use, testInfo) => {
    const extensionDir = stageExtension(
      path.resolve(testInfo.project.testDir, "..", "extension"),
      testInfo.outputPath("extension"),
    );
    // A permitted host these pages do not answer would send the test to the real agency.
    for (const host of AGENCY_HOSTS) expect(ANSWERED_HOSTS, host).toContain(host);
    const executablePath = extensionCapableChromium();
    const agencies = await serveAgencyPages(agencyPages, testInfo.outputPath("agency-tls"));
    const { port } = agencies.address() as AddressInfo;
    const context = await chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      channel: "chromium",
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      baseURL: workerBaseURL,
      viewport: { width: 1280, height: 720 },
      timezoneId: "America/New_York",
      args: [
        ...DETERMINISTIC_RENDERING_ARGS,
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        `--host-resolver-rules=${AGENCY_HOSTS.map((host) => `MAP ${host} 127.0.0.1:${port}`).join(", ")}`,
        "--ignore-certificate-errors",
        // A proxy from the environment would resolve the agency hosts itself.
        "--no-proxy-server",
      ],
    });
    const state = JSON.parse(fs.readFileSync(await staffStorageState("owner"), "utf8")) as {
      cookies: Parameters<BrowserContext["addCookies"]>[0];
    };
    await context.addCookies(state.cookies);
    // The extension's worker and each tab it opens, seen from the browser's side (#2878).
    context.on("serviceworker", (sw) => {
      if (!sw.url().startsWith("chrome-extension://")) return;
      agencyPages.ledger.push([Date.now(), "worker:started"]);
      sw.on("close", () => agencyPages.ledger.push([Date.now(), "worker:closed"]));
    });
    context.on("page", (opened) => {
      agencyPages.ledger.push([Date.now(), `tab:opened ${redactedAddress(opened.url())}`]);
      opened.on("domcontentloaded", () =>
        agencyPages.ledger.push([
          Date.now(),
          `tab:domcontentloaded ${redactedAddress(opened.url())}`,
        ]),
      );
      opened.on("load", () =>
        agencyPages.ledger.push([Date.now(), `tab:load ${redactedAddress(opened.url())}`]),
      );
      opened.on("close", () => agencyPages.ledger.push([Date.now(), "tab:closed"]));
    });
    await context.addInitScript((iso) => {
      const fixed = new Date(iso).getTime();
      const RealDate = Date;
      globalThis.Date = new Proxy(RealDate, {
        construct: (target, args) => Reflect.construct(target, args.length === 0 ? [fixed] : args),
        get: (target, prop, receiver) =>
          prop === "now" ? () => fixed : Reflect.get(target, prop, receiver),
      });
    }, E2E_FROZEN_CLOCK);
    await use(context);
    await context.close();
    await new Promise((resolve) => agencies.close(resolve));
  },

  // The MV3 service worker, up: the extension loaded and its background ran.
  extensionId: async ({ context, agencyPages }, use, testInfo) => {
    const worker =
      context.serviceWorkers().find((sw) => sw.url().startsWith("chrome-extension://")) ??
      (await context.waitForEvent("serviceworker", {
        predicate: (sw) => sw.url().startsWith("chrome-extension://"),
      }));
    agencyPages.ledger.push([Date.now(), "worker:up"]);
    await use(new URL(worker.url()).host);
    if (testInfo.status === testInfo.expectedStatus) return;
    // A failed check says where it stopped: the worker's own phases (names and times only,
    // extension/background.js) beside the agency requests and tabs, on one clock (#2878).
    const current =
      context.serviceWorkers().find((sw) => sw.url().startsWith("chrome-extension://")) ?? null;
    const phases = current
      ? await current
          .evaluate(
            () =>
              (globalThis as { DiveDayCheckPhases?: [number, string][] }).DiveDayCheckPhases ?? [],
          )
          .catch(() => [] as [number, string][])
      : [];
    const events = [
      ...agencyPages.ledger,
      ...phases.map(([at, name]): [number, string] => [at, `worker:${name}`]),
      ...(current === worker ? [] : [[Date.now(), "worker:restarted"] as [number, string]]),
    ].sort(([a], [b]) => a - b);
    const start = events[0]?.[0] ?? 0;
    await testInfo.attach("extension-phases", {
      contentType: "text/plain",
      body: events.map(([at, event]) => `+${String(at - start).padStart(6)}ms ${event}`).join("\n"),
    });
  },
});

const extensionVersion = publishedManifest.version;

/** A new diver with a pending SSI card, made on the diver pages; the page is on their record after. */
async function diverWithPendingSsiCard(page: Page, prefix: string) {
  const stamp = Date.now();
  const name = `${prefix} Realext${stamp}`;
  await page.goto(`/shop/${SHOP}/divers/new`);
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(`realext-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add diver" }).click();
  await page.waitForURL(new RegExp(`/shop/${SHOP}/divers/[0-9a-f-]{36}`));
  const group = await openDiverFileGroup(page, "Certification records");
  await group.getByText("Add certification", { exact: true }).click();
  const form = page
    .locator("form", { has: page.getByRole("button", { name: "Capture for review", exact: true }) })
    .filter({ visible: true });
  await form.locator('select[name="agency"]').selectOption("ssi");
  await form.locator('select[name="card"]').selectOption("level:open_water");
  const cardNumber = `SSI-${stamp}`;
  await form.getByLabel("Certification number").fill(cardNumber);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  const cards = await openDiverFileGroup(page, "Certification records");
  await expect(cards.getByRole("button", { name: "Check with SSI" })).toBeVisible();
  return { name, cardNumber, cards };
}

/**
 * A new diver born 12 April 1990 with a pending PADI Open Water card, made on
 * the diver pages; the page is on their record after. The seeded demo runs the
 * PADI checks (`shops.padi_checks_enabled`), so the card offers one.
 */
async function diverWithPendingPadiCard(page: Page) {
  const stamp = Date.now();
  const name = `Padi Realext${stamp}`;
  await page.goto(`/shop/${SHOP}/divers`);
  await page.getByRole("searchbox", { name: "Search divers" }).fill(name);
  await page.getByRole("button", { name: "Add diver", exact: true }).click();
  await expect(page).toHaveURL(/\/divers\/[0-9a-f-]+(\?edit=1)?$/);
  await page.getByLabel("Date of birth").fill("1990-04-12");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toContainText("Diver details updated");
  const group = await openDiverFileGroup(page, "Certification records");
  await group.getByText("Add certification", { exact: true }).click();
  const form = page
    .locator("form", { has: page.getByRole("button", { name: "Capture for review", exact: true }) })
    .filter({ visible: true });
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="card"]').selectOption("level:open_water");
  const cardNumber = `1506AB${String(stamp).slice(-4)}`;
  await form.getByLabel("Certification number").fill(cardNumber);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  const cards = await openDiverFileGroup(page, "Certification records");
  await expect(cards.getByRole("button", { name: "Check with PADI" })).toBeVisible();
  return { name, cardNumber, cards };
}

test("DiveDay sees the installed extension, and settings says this browser has it", async ({
  page,
  extensionId,
}) => {
  test.setTimeout(30_000);
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  await page.goto(`/shop/${SHOP}/settings#cert-check`);
  await expect(page.locator("html")).toHaveAttribute("data-diveday-cert-check", extensionVersion);
  const row = page
    .locator("details")
    .filter({ has: page.getByRole("heading", { name: "Card checks", exact: true }) });
  await expect(
    row.getByText(`Added to this browser (${extensionVersion})`, { exact: true }),
  ).toBeVisible();
  await expect(row.getByText("Not added", { exact: true })).toHaveCount(0);
});

test("Check with SSI fills SSI's page, certifies on a clear match, and Undo puts it back", async ({
  page,
  extensionId,
  agencyPages,
}) => {
  test.setTimeout(60_000);
  void extensionId;
  const { name, cardNumber, cards } = await diverWithPendingSsiCard(page, "Ada");

  await cards.getByRole("button", { name: "Check with SSI" }).click();

  const toast = page.getByRole("status").filter({ hasText: CERTIFIED });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await expect(cards.getByText(/^Checked with SSI by /)).toBeVisible();
  // The extension typed the diver's name and card number into SSI's form.
  const searched = new URL(
    "https://my.divessi.com/online_diver_check?" +
      new URLSearchParams({ diver_name: name, card_number: cardNumber }).toString(),
  );
  expect(agencyPages.requests).toContain(`GET ${searched.href}`);

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(cards.getByRole("button", { name: "Check with SSI" })).toBeVisible();
  await expect(cards.getByText(/^Checked with SSI by /)).toHaveCount(0);
});

test("signed out of PADI, the check says to sign in first and types nothing into PADI's sign-in", async ({
  page,
  extensionId,
  agencyPages,
}) => {
  test.setTimeout(90_000);
  void extensionId;
  const { cards } = await diverWithPendingPadiCard(page);
  const signInFirst = cards.getByText("Sign in to the PADI Pros’ Site first, then check again.");

  // DiveChek's own address showing PADI's sign-in form.
  await cards.getByRole("button", { name: "Check with PADI" }).click();
  await expect(signInFirst).toBeVisible({ timeout: 20_000 });
  expect(agencyPages.requests).toContain("GET https://pro.padi.com/divechek");
  expect(agencyPages.typedIntoSignIn).toEqual([]);
  expect(agencyPages.requests.filter((request) => request.startsWith("POST"))).toEqual([]);
  await expect(cards.getByText("Couldn’t read PADI’s page.")).toHaveCount(0);
  await expect(page.getByText("PADI shows this certification. Marked certified.")).toHaveCount(0);

  // DiveChek sending the tab to PADI's sign-in on a host the extension has no permission for.
  agencyPages.padi = "sign-in-redirect";
  agencyPages.requests.length = 0;
  await page.reload();
  const reloaded = await openDiverFileGroup(page, "Certification records");
  const signInAgain = reloaded.getByText("Sign in to the PADI Pros’ Site first, then check again.");
  await expect(signInAgain).toHaveCount(0);
  await reloaded.getByRole("button", { name: "Check with PADI" }).click();
  await expect(signInAgain).toBeVisible({ timeout: 20_000 });
  expect(agencyPages.requests).toContain("GET https://login.padi.com/sign-in?return=%2Fdivechek");
  expect(agencyPages.typedIntoSignIn).toEqual([]);
  expect(agencyPages.requests.filter((request) => request.startsWith("POST"))).toEqual([]);
  await expect(reloaded.getByRole("button", { name: "Check with PADI" })).toBeEnabled();
});

test("signed in to PADI, DiveChek sent on to pros.padi.com is read, its Run Report pressed, and the card certified", async ({
  page,
  extensionId,
  agencyPages,
}) => {
  test.setTimeout(90_000);
  void extensionId;
  agencyPages.padi = "signed-in-on-pros";
  const { name, cardNumber, cards } = await diverWithPendingPadiCard(page);
  agencyPages.padiCardNumber = cardNumber;

  await cards.getByRole("button", { name: "Check with PADI" }).click();

  const toast = page
    .getByRole("status")
    .filter({ hasText: "PADI shows this certification. Marked certified." });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await expect(cards.getByText(/^Checked with PADI by /)).toBeVisible();
  await expect(
    cards.getByText("Sign in to the PADI Pros’ Site first, then check again."),
  ).toHaveCount(0);
  // The tab opened PADI's own host, was sent on to the other, and Run Report searched there.
  expect(agencyPages.requests).toContain("GET https://pro.padi.com/divechek");
  const [first, last] = name.split(" ");
  const searched = new URL(
    "https://pros.padi.com/divechek?" +
      new URLSearchParams({
        first_name: first ?? "",
        last_name: last ?? "",
        dob: "04/12/1990",
      }).toString(),
  );
  expect(agencyPages.requests).toContain(`GET ${searched.href}`);
  expect(agencyPages.typedIntoSignIn).toEqual([]);

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(cards.getByRole("button", { name: "Check with PADI" })).toBeVisible();
});

test("signed out of PADI between the form and its answer, the check says to sign in and certifies nothing", async ({
  page,
  extensionId,
  agencyPages,
}) => {
  test.setTimeout(90_000);
  void extensionId;
  agencyPages.padi = "expires-on-search";
  const { cardNumber, cards } = await diverWithPendingPadiCard(page);
  agencyPages.padiCardNumber = cardNumber;

  await cards.getByRole("button", { name: "Check with PADI" }).click();

  await expect(
    cards.getByText("Sign in to the PADI Pros’ Site first, then check again."),
  ).toBeVisible({ timeout: 20_000 });
  // The search was sent, and answered with PADI's sign-in, which nothing was typed into.
  expect(agencyPages.requests.some((request) => request.includes("first_name="))).toBe(true);
  expect(agencyPages.typedIntoSignIn).toEqual([]);
  await expect(page.getByText("PADI shows this certification. Marked certified.")).toHaveCount(0);
  await expect(cards.getByText(/^Checked with PADI by /)).toHaveCount(0);
});

// diveday:quarantine #2878 until 2026-10-28: CI can stall on the first SSI lookup before filling its form; nightly retains the exact check.
test("Check all on a departure settles its rows one at a time through the extension @quarantine", async ({
  page,
  extensionId,
  agencyPages,
}) => {
  test.setTimeout(120_000);
  void extensionId;
  const { name: newcomer } = await diverWithPendingSsiCard(page, "Rory");
  const trip = await findTripOnBoard(page, SHOP, DEPARTURE);
  await trip.click();
  await openTripTab(page, "Trip");
  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).fill(newcomer);
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).press("Enter");
  await addDiver.getByRole("button", { name: `Add ${newcomer} to the trip` }).click();
  await expect(
    rosterRow(page, newcomer).getByRole("button", { name: "Check with SSI" }),
  ).toBeVisible();
  await expect(
    rosterRow(page, SEEDED_DIVER).getByRole("button", { name: "Check with SSI" }),
  ).toBeVisible();
  const settled = page
    .getByRole("region", { name: "Divers", exact: true })
    .locator("li")
    .filter({ hasText: CERTIFIED });
  // "Checking 2 of 2…" lasts only as long as the second lookup, a few seconds
  // that a loaded runner can spend between two polls. SSI holds that answer
  // until the first card has been seen settled and the second still checking.
  let openSecondLookup = () => {};
  agencyPages.ssiHold = {
    after: 1,
    open: new Promise<void>((resolve) => {
      openSecondLookup = resolve;
    }),
  };

  await page.getByRole("button", { name: "Check all 2 cards with their agencies" }).click();

  // One card at a time: while the second is being looked up, only the first has settled.
  await expect(page.getByText("Checking 2 of 2…")).toBeVisible({ timeout: 20_000 });
  await expect(settled).toHaveCount(1);
  openSecondLookup();
  await expect(page.getByText("Checked 2. Certified: 2.")).toBeVisible({ timeout: 20_000 });
  for (const diver of [SEEDED_DIVER, newcomer]) {
    await expect(rosterRow(page, diver).getByText(CERTIFIED)).toBeVisible();
    await expect(
      rosterRow(page, diver).getByRole("button", { name: "Check with SSI" }),
    ).toHaveCount(0);
  }
  expect(agencyPages.requests.filter((request) => request.includes("diver_name="))).toHaveLength(2);
});

test("after a match, the other cards SSI's page lists are offered, and the ticked ones land pending", async ({
  page,
  extensionId,
  agencyPages,
}) => {
  test.setTimeout(60_000);
  void extensionId;
  agencyPages.ssiListsMore = true;
  const { cards } = await diverWithPendingSsiCard(page, "Mae");

  await cards.getByRole("button", { name: "Check with SSI" }).click();
  await expect(page.getByRole("status").filter({ hasText: CERTIFIED })).toBeVisible({
    timeout: 20_000,
  });
  const offer = cards.getByRole("group", { name: LISTED_LEAD });
  await expect(offer.getByRole("checkbox", { name: "Enriched Air Nitrox" })).toBeChecked();
  await expect(offer.getByRole("checkbox", { name: "Deep Diving" })).toBeChecked();

  await offer.getByRole("checkbox", { name: "Deep Diving" }).uncheck();
  await offer.getByRole("button", { name: "Add" }).click();
  await expect(cards.getByText("Added")).toBeVisible();

  const nitrox = cards.getByRole("listitem").filter({ hasText: "SSI · Nitrox" });
  await expect(nitrox.getByText("Listed on SSI’s page.")).toBeVisible();
  await expect(nitrox.getByRole("button", { name: "Mark certified" })).toBeVisible();
  await expect(cards.getByRole("listitem").filter({ hasText: "SSI · Deep" })).toHaveCount(0);
});

test("a captcha on SSI's form is the staffer's to answer: nothing is typed, and the row says so", async ({
  page,
  extensionId,
  agencyPages,
}) => {
  test.setTimeout(60_000);
  void extensionId;
  const { cards } = await diverWithPendingSsiCard(page, "Cy");
  agencyPages.ssiForm = "captcha";
  agencyPages.requests.length = 0;

  await cards.getByRole("button", { name: "Check with SSI" }).click();

  await expect(cards.getByText("SSI is asking if you’re human. Check on its page.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(cards.getByRole("link", { name: "Check with SSI" })).toBeVisible();
  // The form was opened and never sent.
  expect(agencyPages.requests).toContain("GET https://my.divessi.com/online_diver_check");
  expect(agencyPages.requests.filter((request) => request.includes("diver_name="))).toEqual([]);
  await expect(cards.getByText(/^Checked with SSI by /)).toHaveCount(0);
});

test("SSI's page with its boxes renamed reads as a changed page, and nothing is sent", async ({
  page,
  extensionId,
  agencyPages,
}) => {
  test.setTimeout(60_000);
  void extensionId;
  const { cards } = await diverWithPendingSsiCard(page, "Rene");
  agencyPages.ssiForm = "renamed";
  agencyPages.requests.length = 0;

  await cards.getByRole("button", { name: "Check with SSI" }).click();

  await expect(cards.getByText("SSI’s page has changed. Check on its page.")).toBeVisible({
    timeout: 30_000,
  });
  expect(agencyPages.requests.filter((request) => request.includes("diver_name="))).toEqual([]);
  await expect(cards.getByText(/^Checked with SSI by /)).toHaveCount(0);
});

test("Try the checks runs every sample lookup in the extension, reads PADI's tab, and reports no person", async ({
  page,
  context,
  extensionId,
  agencyPages,
}) => {
  test.setTimeout(90_000);
  void extensionId;
  await page.goto(`/shop/${SHOP}/settings#cert-check`);
  const row = page
    .locator("details")
    .filter({ has: page.getByRole("heading", { name: "Card checks", exact: true }) });
  await expect(row).toHaveAttribute("open", "");
  // A disclosure on the row, not a page of its own (#2817).
  await row.getByText("Try the checks", { exact: true }).click();
  await expect(page).toHaveURL(`/shop/${SHOP}/settings#cert-check`);
  await expect(row.getByRole("button", { name: "Run the checks" })).toBeVisible();
  await expect(
    row.getByText(`Added to this browser (${extensionVersion})`, { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run the checks" }).click();

  const samples = page.getByRole("list", { name: "Sample lookups" });
  for (const agency of ["SSI", "NAUI", "SDI", "GUE", "CMAS"]) {
    await expect(samples.getByRole("listitem").filter({ hasText: agency })).toContainText(
      "Passed",
      { timeout: 30_000 },
    );
  }
  await expect(page.getByText("No PADI tab open")).toBeVisible();
  // No agency was searched: the samples are the extension's own pages.
  expect(agencyPages.requests).toEqual([]);
  await row.getByText("View report", { exact: true }).click();
  const report = page.getByText(/"report": "diveday-cert-check-try"/);
  await expect(report).toContainText(`"extension": "${extensionVersion}"`);
  await expect(report).not.toContainText("Alex");
  await expect(report).not.toContainText("Sample");

  // A signed-in Pros' Site tab is read for that alone: nothing is searched in it.
  agencyPages.padi = "signed-in-on-pros";
  const padi = makeActivitySafe(await context.newPage());
  await padi.goto("https://pros.padi.com/divechek");
  await padi.getByRole("button", { name: "Run Report" }).waitFor();
  agencyPages.requests.length = 0;
  await page.bringToFront();
  await page.getByRole("button", { name: "Run the checks" }).click();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(agencyPages.requests.filter((request) => request.includes("first_name="))).toEqual([]);
});
