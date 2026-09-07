import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { makeActivitySafe } from "../../e2e/fixtures";
import { seededTripId, signInAs } from "../../e2e/helpers";
import { E2E_FROZEN_CLOCK, E2E_TEST_ROUTE_SECRET } from "../../e2e/servers";
import { DEV_STAFF_LOGINS } from "../../src/db/dev-credentials";
import { DEMO_RECAP_BOOKING_ID } from "../../src/db/seed";
import { CAPABILITY_ROUTE_PREFIXES, redactCapabilityUrl } from "../../src/lib/capability-urls";
import { signRecapToken } from "../../src/lib/recap-links";
import { fingerprint } from "./lib.mjs";
import { lensesFor, PERSONAS, personaLabel, WALK_SHOP_SLUG } from "./personas.mjs";
import {
  TAP_TARGET_FLOOR_PX,
  VIEWPORTS,
  WALK_BASE_URL,
  WALK_FINDINGS_FILE,
  WALK_ONLY,
  WALK_OUT_DIR,
} from "./topology";

/**
 * **The weekly persona walk** (N-61).
 *
 * Each of the fifteen personas in `docs/product/personas.md` is walked through
 * their own surfaces on their own device, in the language they ask for, signed
 * in as whoever they are — and at every stop a handful of lenses are read
 * (`personas.mjs`). What they see is written to `personas/findings.json`, with
 * a screenshot for every stop that produced something;
 * `scripts/persona-bots-file.mjs` then decides, under a hard cap, which of it
 * the tracker hears about.
 *
 * **Nothing here is an assertion about the product.** A persona that cannot
 * reach a stop records a `stop-unreachable` finding and walks on to the next
 * one; a persona whose walk throws ends that persona and not the run. The spec
 * fails only if the harness itself breaks, because a walk is a report and a
 * report that reddens a build is a gate wearing a disguise. That is also why it
 * is not in `e2e/`.
 *
 * The seeded demo shop is the subject, on the fleet's frozen clock — a walk at
 * a real 3am would find an empty board and file the emptiness.
 */

const SEEDED_DEPARTURE_TITLE = "Two-Tank Reef — Molasses & French";
const BOOKING_NAME = "Rob Walkthrough";

/**
 * Requests this harness cannot serve, and whose absence says nothing about the
 * product. Vercel injects `/_vercel/insights/script.js` and its speed-insights
 * twin at the edge; `next start` on a laptop has no edge, so both 404 on every
 * page of every walk. Reported, they would take the whole filing budget every
 * week for a fact about the runner.
 *
 * Kept to that one prefix on purpose. The lens is worth having precisely
 * because it catches a request that should have worked, so an exclusion here
 * has to be a thing the environment cannot provide rather than a thing that is
 * merely broken.
 */
const ONLY_A_DEPLOYMENT_SERVES = ["/_vercel/"];

const servedElsewhere = (url: string) =>
  ONLY_A_DEPLOYMENT_SERVES.some((prefix) => url.includes(prefix));

/**
 * The browser cancelling a request it no longer needs, which is what walking on
 * from a page that is still streaming looks like from here. It says nothing
 * about the page and it would otherwise be charged to the *next* stop, since a
 * console listener has no idea which navigation a late line belongs to.
 *
 * Only this one. A reset, a refused connection and a 500 all stay reportable —
 * they are the same shape a diver's phone would meet, and the walk reports
 * rather than gates precisely so a lead like that can be looked at by a person
 * instead of argued with by a rule.
 */
const CANCELLED = "net::ERR_ABORTED";

type Finding = {
  personaId: string;
  personaNumber: number;
  personaName: string;
  personaLabel: string;
  stopId: string;
  url: string;
  lens: string;
  headline: string;
  detail: string;
  touches: string[];
  screenshot?: string;
  fingerprint: string;
};

const walk = {
  startedAt: new Date().toISOString(),
  findings: [] as Finding[],
  tripId: "",
  recapToken: "",
};

let api: APIRequestContext;

/**
 * Deliberately **not** `mode: "serial"`, which the one-day simulation uses:
 * there a state depends on the one before it, so skipping the rest is the
 * honest outcome. Here the personas are independent, and a walk that stopped at
 * the first one to fall over would report fourteen clean people it never
 * looked at. They still run in order — `workers: 1`, `fullyParallel: false`.
 */

test.beforeAll(async ({ playwright, browser }) => {
  mkdirSync(WALK_OUT_DIR, { recursive: true });
  api = await playwright.request.newContext({
    baseURL: WALK_BASE_URL,
    extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
  });
  // The first request pays the one-time migrate and seed; after it the demo
  // shop is the canonical fixture every persona reads.
  const reset = await api.post("/api/test/reset", { timeout: 120_000 });
  if (!reset.ok()) throw new Error(`reset failed: ${reset.status()} ${await reset.text()}`);

  const context = await newContext(browser, PERSONAS[0]);
  const page = makeActivitySafe(await context.newPage());
  await signInAs(page, DEV_STAFF_LOGINS.owner);
  walk.tripId = await seededTripId(page, WALK_SHOP_SLUG, SEEDED_DEPARTURE_TITLE);
  await context.close();
  walk.recapToken = signRecapToken(DEMO_RECAP_BOOKING_ID);
  writeFindings();
});

test.afterAll(async () => {
  writeFindings();
  await api?.dispose();
});

for (const persona of PERSONAS) {
  if (WALK_ONLY && WALK_ONLY !== persona.id) continue;
  test(personaLabel(persona), async ({ browser }) => {
    const context = await newContext(browser, persona);
    const page = makeActivitySafe(await context.newPage());
    const log = wireConsole(page);
    try {
      if (persona.actor !== "public") {
        await signInAs(page, DEV_STAFF_LOGINS[persona.actor as keyof typeof DEV_STAFF_LOGINS]);
      }
      for (const stop of persona.stops as Stop[]) {
        log.clear();
        await walkStop(persona, stop, page, log);
      }
    } catch (error) {
      // A walk that falls over is a finding, not a red build: the personas
      // after this one still have their own surfaces to look at.
      record(persona, persona.stops[0] as Stop, page.url(), {
        lens: "stop-unreachable",
        headline: `${persona.name}'s walk stopped early`,
        detail: messageOf(error),
      });
    } finally {
      // A context that will not close is the machine's problem, not the
      // persona's, and it must not turn their walk into a failed test.
      await context.close().catch(() => {});
      writeFindings();
    }
  });
}

type Persona = (typeof PERSONAS)[number];
/**
 * One stop, stated rather than inferred. `personas.mjs` is plain JavaScript so
 * that a script can load it without a compile step, and the union TypeScript
 * infers from those object literals has a different shape per stop — `flow`
 * exists on some members and not others, which is exactly what this walk needs
 * to branch on.
 */
type Stop = {
  id: string;
  path?: string;
  flow?: string;
  touches?: string[];
  expectMissing?: boolean;
};
type ConsoleLog = { errors: string[]; failures: string[]; clear: () => void };

async function walkStop(persona: Persona, stop: Stop, page: Page, log: ConsoleLog) {
  const before = walk.findings.length;
  let url = stop.path ? resolve(stop.path) : `flow:${stop.flow}`;
  try {
    if (stop.flow === "book-and-sign") {
      url = await bookAndSign(page);
    } else {
      const response = await page.goto(resolve(stop.path ?? "/"));
      const status = response?.status() ?? 0;
      url = new URL(page.url()).pathname + new URL(page.url()).search;
      if (status >= 500) {
        record(persona, stop, url, {
          lens: "request-failed",
          headline: `the page itself answered ${status}`,
          detail: `GET ${stop.path} answered ${status}`,
        });
      }
    }
    await settled(page);
  } catch (error) {
    record(persona, stop, url, {
      lens: "stop-unreachable",
      headline: `${persona.name} could not reach ${stop.id}`,
      detail: messageOf(error),
    });
    await capture(persona, stop, page, before);
    return;
  }

  for (const lens of lensesFor(persona)) {
    try {
      await readLens(lens, persona, stop, page, url, log);
    } catch (error) {
      record(persona, stop, url, {
        lens: "stop-unreachable",
        headline: `the ${lens} lens could not be read at ${stop.id}`,
        detail: messageOf(error),
      });
    }
  }
  await capture(persona, stop, page, before);
}

async function readLens(
  lens: string,
  persona: Persona,
  stop: Stop,
  page: Page,
  url: string,
  log: ConsoleLog,
) {
  switch (lens) {
    case "console-error": {
      for (const message of log.errors) {
        record(persona, stop, url, {
          lens,
          headline: "the page wrote an error to the console",
          detail: message,
        });
      }
      return;
    }
    case "request-failed": {
      for (const failure of log.failures) {
        // A stop whose whole point is the refusal it lands on says so in the
        // registry: Tomas opening a departure that no longer exists, Kai
        // pushing on a door his role cannot open. Reporting those 404s would
        // file the product working exactly as designed.
        if (stop.expectMissing && failure.endsWith("404")) continue;
        record(persona, stop, url, {
          lens,
          headline: "a request the page made was refused",
          detail: failure,
        });
      }
      return;
    }
    case "blank-render": {
      // A diver Client Component reading copy with no `DiverIntlProvider` above
      // it throws during the server render and degrades to a blank client-only
      // 200 — a page with a title, no error, and nothing on it.
      const rendered = await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        return {
          heading: Boolean(document.querySelector("h1, h2")),
          text: (main.textContent ?? "").trim().length,
        };
      });
      if (!rendered.heading || rendered.text < 40) {
        record(persona, stop, url, {
          lens,
          headline: "the page rendered with no heading and almost no text",
          detail: `heading: ${rendered.heading}; characters inside <main>: ${rendered.text}`,
        });
      }
      return;
    }
    case "page-language": {
      const declared = (await page.getAttribute("html", "lang")) ?? "";
      const asked = persona.locale.split("-")[0].toLowerCase();
      if (!declared || declared.split("-")[0].toLowerCase() !== asked) {
        record(persona, stop, url, {
          lens,
          headline: `the document says lang="${declared}" to a reader asking for ${persona.locale}`,
          detail: `Accept-Language: ${persona.locale}; <html lang>: ${declared || "(absent)"}`,
        });
      }
      return;
    }
    case "no-skip-link": {
      const skip = await page.locator("a[href^='#']").filter({ hasText: /^Skip/i }).count();
      if (skip === 0) {
        record(persona, stop, url, {
          lens,
          headline: "the page offers no skip link",
          detail: "no anchor whose text begins 'Skip' points at an id on this page",
        });
      }
      return;
    }
    case "axe": {
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      for (const violation of scan.violations) {
        if (violation.impact !== "serious" && violation.impact !== "critical") continue;
        record(persona, stop, url, {
          lens,
          headline: `axe rule "${violation.id}" fails here`,
          detail: [
            `${violation.id} (${violation.impact}): ${violation.help}`,
            ...violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
          ].join("\n"),
        });
      }
      return;
    }
    case "tap-target": {
      // The element's own box, which is what a thumb meets — deliberately not a
      // pseudo-element overlay, which a parent's `overflow-hidden` may clip
      // (`e2e/a11y.spec.ts` carries the story of the row links that fooled it).
      const undersized = await page.evaluate((floor) => {
        const isSkipLink = (element: Element) =>
          element.tagName === "A" && (element.textContent ?? "").trim().startsWith("Skip");
        const labelCoversIt = (element: Element) => {
          if (element.tagName !== "INPUT") return false;
          const label = element.closest("label");
          return Boolean(label && label.getBoundingClientRect().height >= floor);
        };
        const name = (element: Element) =>
          (element.getAttribute("aria-label") || element.textContent || element.tagName)
            .trim()
            .slice(0, 60);
        return [...document.querySelectorAll("main a, main button, main summary, main input")]
          .filter((element) => {
            if (isSkipLink(element) || labelCoversIt(element)) return false;
            const box = element.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return false;
            return box.width < floor || box.height < floor;
          })
          .slice(0, 5)
          .map((element) => {
            const box = element.getBoundingClientRect();
            return `${element.tagName.toLowerCase()} "${name(element)}" is ${Math.round(box.width)}x${Math.round(box.height)}`;
          });
      }, TAP_TARGET_FLOOR_PX);
      if (undersized.length > 0) {
        record(persona, stop, url, {
          lens,
          headline: `${undersized.length} control${undersized.length === 1 ? "" : "s"} sit under the ${TAP_TARGET_FLOOR_PX}px floor`,
          detail: undersized.join("\n"),
        });
      }
      return;
    }
    default:
      return;
  }
}

/**
 * Rob's own flow: book a seat on the public departure page, land on the thread
 * the booking mints, and open the waiver from it. The two token surfaces he
 * actually reads at 11pm exist only behind a booking, so the walk makes one.
 */
async function bookAndSign(page: Page): Promise<string> {
  await page.goto(`/s/${WALK_SHOP_SLUG}/trips/${walk.tripId}`);
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill(BOOKING_NAME);
  await page.getByLabel("Email", { exact: true }).fill("rob.walkthrough@example.com");
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page).toHaveURL(/\/ready\//);
  await page.getByRole("button", { name: "Sign your waiver" }).click();
  await expect(page).toHaveURL(/\/waivers\//);
  return "/waivers/<token>";
}

/**
 * The page has settled when its own document has: a title, and no animation
 * still moving. Deliberately not `networkidle` — `pnpm check:e2e-hygiene`
 * refuses it, and the a11y suite has the receipts for why.
 */
async function settled(page: Page) {
  await expect(page).toHaveTitle(/.*/);
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((animation) => {
            const duration = Number(animation.effect?.getTiming().duration ?? 0);
            return Number.isFinite(duration) && duration > 0;
          })
          .every((animation) => animation.playState !== "running"),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
}

/**
 * A capability URL anywhere in a string, in the shape `src/lib/capability-urls.ts`
 * knows: `/waivers/<token>`, `/ready/<token>`, `/recap/<token>` and the rest.
 * Rob's walk is on two of those pages, so a Playwright error, a console line or
 * a refused request from there carries the token in its text.
 */
const CAPABILITY_IN_TEXT = new RegExp(
  `/(${CAPABILITY_ROUTE_PREFIXES.join("|")})/[^\\s"'\`)\\]]+`,
  "gi",
);

/**
 * **Everything a finding carries is on its way to a public issue**, so the one
 * class of value that must never travel there is stripped at the single choke
 * point rather than at each call site: the URL *is* the capability on those
 * pages ([capability-telemetry-runbook.md](../../docs/engineering/capability-telemetry-runbook.md)),
 * and a bot that published one would be handing out a signing link. The walk's
 * own tokens are minted against a database that dies with the run, which is
 * exactly why this has to be right before that stops being true.
 */
function redact(text: string): string {
  return String(text ?? "").replace(CAPABILITY_IN_TEXT, (_, prefix) => `/${prefix}/[token]`);
}

function record(
  persona: Persona,
  stop: Stop,
  url: string,
  found: { lens: string; headline: string; detail: string },
) {
  const base = {
    personaId: persona.id,
    personaNumber: persona.number,
    personaName: persona.name,
    personaLabel: personaLabel(persona),
    stopId: stop.id,
    url: redactCapabilityUrl(url),
    touches: [...(stop.touches ?? [])],
    ...found,
    headline: redact(found.headline),
    detail: redact(found.detail),
  };
  walk.findings.push({ ...base, fingerprint: fingerprint(base) });
}

/** One screenshot per stop that found something — the only ones worth keeping. */
async function capture(persona: Persona, stop: Stop, page: Page, before: number) {
  const found = walk.findings.slice(before);
  if (found.length === 0) return;
  const name = `${persona.id}-${stop.id}.png`;
  try {
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(WALK_OUT_DIR, name),
      fullPage: true,
      animations: "disabled",
    });
    for (const finding of found) finding.screenshot = name;
  } catch {
    // A screenshot that cannot be taken is not worth losing the finding over.
  }
}

function wireConsole(page: Page): ConsoleLog {
  const log: ConsoleLog = {
    errors: [],
    failures: [],
    clear: () => {
      log.errors.length = 0;
      log.failures.length = 0;
    },
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // A failed resource is reported twice — once as a response and once as a
    // console line whose `location` is the resource itself. Both halves of an
    // excluded request are excluded, or the exclusion buys nothing.
    if (servedElsewhere(message.location().url ?? "")) return;
    if (servedElsewhere(message.text())) return;
    if (message.text().includes(CANCELLED)) return;
    log.errors.push(message.text());
  });
  page.on("pageerror", (error) => log.errors.push(`uncaught: ${error.message}`));
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const target = new URL(response.url());
    if (target.origin !== new URL(WALK_BASE_URL).origin) return;
    if (servedElsewhere(target.pathname)) return;
    log.failures.push(`${response.request().method()} ${target.pathname} answered ${status}`);
  });
  return log;
}

async function newContext(browser: Browser, persona: Persona) {
  const context: BrowserContext = await browser.newContext({
    viewport: VIEWPORTS[persona.viewport as keyof typeof VIEWPORTS],
    locale: persona.locale,
    extraHTTPHeaders: {
      authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}`,
      "accept-language": persona.locale,
    },
  });
  // The same browser-clock pin the fleet's `context` fixture applies, for the
  // same reason: the seed is clock-anchored, and a browser on the real clock
  // would render a departure as long gone.
  await context.addInitScript((iso) => {
    const fixed = new Date(iso).getTime();
    const RealDate = Date;
    globalThis.Date = new Proxy(RealDate, {
      construct: (target, args) => Reflect.construct(target, args.length === 0 ? [fixed] : args),
      get: (target, prop, receiver) =>
        prop === "now" ? () => fixed : Reflect.get(target, prop, receiver),
    });
  }, E2E_FROZEN_CLOCK);
  return context;
}

function resolve(pathname: string): string {
  return pathname.replace("{tripId}", walk.tripId).replace("{recapToken}", walk.recapToken);
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\nCall log")[0];
}

function writeFindings(): void {
  writeFileSync(
    WALK_FINDINGS_FILE,
    `${JSON.stringify(
      {
        startedAt: walk.startedAt,
        finishedAt: new Date().toISOString(),
        shopSlug: WALK_SHOP_SLUG,
        personas: PERSONAS.length,
        stops: PERSONAS.reduce((total, persona) => total + persona.stops.length, 0),
        findings: walk.findings,
      },
      null,
      2,
    )}\n`,
  );
}
