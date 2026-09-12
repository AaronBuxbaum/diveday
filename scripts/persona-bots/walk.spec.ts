import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../../src/db/dev-credentials";
import { runBounded, SUBPROCESS_TIMEOUTS } from "../subprocess.mjs";
import { classify } from "./findings.mjs";
import { DEMO_SHOP_SLUG, JUDGE_PERSONAS, walkPlan } from "./personas.mjs";
import {
  JUDGED_SCREENSHOT_CAP,
  PERSONA_BASE_URL,
  PERSONA_FINDINGS_FILE,
  PERSONA_OUT_DIR,
  SCREENSHOT_CAP,
} from "./topology";

/**
 * **The weekly persona walk** (N-61): every surface `docs/product/personas.md`
 * names, opened as the persona who lives on it, against the demo shop.
 *
 * Each visit runs the probes in `scripts/persona-bots/personas.mjs` — an axe
 * scan plus a short list of DOM-level checks, all of them deterministic — and
 * writes what fired to `persona-bots/findings.json`. `scripts/persona-bots.mjs`
 * reads that file, shapes the findings into `needs-triage` issues, and applies
 * the volume policy in `scripts/persona-bots/findings.mjs`.
 *
 * **Nothing here fails on a finding.** A defect is data; the exit code means
 * the harness broke. That split is what lets the bot fail open: an incomplete
 * walk files nothing rather than filing whatever it happened to reach.
 */

type Finding = {
  probe: string;
  path: string;
  personas: string[];
  detail: string;
  impact?: string;
};

const findings: Finding[] = [];
/** Filled by the last test; keyed by the URL path each picture is of. */
const screenshots: Record<string, string> = {};
/**
 * The stops the opt-in judged pass (#1498) is to read, written into the report
 * so the second pass never re-derives the walk plan. Empty unless
 * `PERSONA_BOTS_JUDGE=1`.
 */
type JudgeStop = {
  path: string;
  personas: string[];
  as: string | null;
  locale: string;
  screenshot?: string;
};
const judgeStops: JudgeStop[] = [];
/**
 * How many surfaces were actually opened, counted rather than assumed.
 *
 * "No findings" and "nothing was walked" produce an identical empty list, and
 * this repository has been caught by that shape before — a visual run with no
 * baseline resolved reports zero differences. The run summary prints this
 * beside the finding count so a silent walk cannot read as a clean one.
 */
let walked = 0;

/** One signed-in context per staff role, opened on first use and reused. */
const contexts = new Map<string, BrowserContext>();

test.beforeAll(() => {
  mkdirSync(PERSONA_OUT_DIR, { recursive: true });
  writeFileSync(PERSONA_FINDINGS_FILE, JSON.stringify({ findings: [], screenshots: {} }, null, 2));
});

test.afterAll(async () => {
  for (const context of contexts.values()) await context.close();
});

/**
 * A message key that reached the screen instead of a sentence —
 * `shop.today.heading` where "Today" belongs, which is what a lookup that did
 * not resolve renders as.
 *
 * Deliberately strict on two counts, because the cheap version of this probe
 * files a false positive every week forever. The token needs **three or more**
 * dot-separated lowerCamel segments, and it has to be an element's **entire**
 * text: a key stands alone as a whole label, while the thing that otherwise
 * looks identical — a hostname like `app.diveday.example` — is embedded in
 * prose or inside a link. Links, code and sample elements are skipped for the
 * same reason.
 */
const MESSAGE_KEY = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*){2,}$/;

/**
 * Console errors this harness causes and a diver never sees.
 *
 * `@vercel/analytics` and `@vercel/speed-insights` each mount a
 * `<script src="/_vercel/…/script.js">` on every page. Those paths exist only
 * on Vercel's edge, so a `next start` under `pnpm e2e:build` answers them with
 * the not-found document and Chromium refuses the wrong MIME type — on our own
 * origin, which is why the origin filter above does not catch them. Measured on
 * the first two dry runs: one per script per page, on all thirty-one, and
 * filing it weekly would be the bot reporting its own test rig. The whole
 * `/_vercel/` prefix rather than either script by name, because the third one
 * would arrive the same way.
 */
const HARNESS_NOISE = /\/_vercel\//;

for (const visit of walkPlan()) {
  test(`${visit.as ?? "a visitor"} at ${visit.path}${visit.locale === "en-US" ? "" : ` (${visit.locale})`}`, async ({
    browser,
  }) => {
    // **One retry, and only on a renderer that went away.** Measured on the
    // third dry run: the Spanish storefront's tab crashed between the
    // navigation and the axe scan, and both the scan and the probe after it
    // came back "Target page, context or browser has been closed". That is the
    // runner running out of room, not a defect on the page — the same surface
    // passed in English seconds earlier and in Spanish on the run before — and
    // treating it as a finding would file a lie. Treating it as fatal is not
    // much better: a visit that cannot complete makes the walk incomplete, and
    // an incomplete walk deliberately files nothing, so one crashed tab
    // silently costs the whole week.
    //
    // So it is caught by its own signature and taken again on a fresh page,
    // exactly as `scripts/screenshot.mjs` retries a dev server that dropped the
    // connection, and for the same reason: this is not a race being papered
    // over, it is one specific way the machine underneath can fail. A second
    // failure fails the visit, and the run files nothing.
    const findingsBefore = findings.length;
    try {
      await visitSurface(browser, visit);
    } catch (error) {
      if (!TARGET_GONE.test(String(error))) throw error;
      console.warn(`persona-bots: the tab went away on ${visit.path} — taking it again.`);
      findings.length = findingsBefore;
      await visitSurface(browser, visit, { freshContext: true });
    }
    walked += 1;
    writeFindings();
  });
}

/** One surface, opened and probed. Throws only when the harness broke. */
async function visitSurface(
  browser: import("@playwright/test").Browser,
  visit: ReturnType<typeof walkPlan>[number],
  { freshContext = false } = {},
) {
  if (freshContext) await dropContext(visit.as, visit.locale);
  const page = await openPage(browser, visit.as, visit.locale);
  // **Only errors this app raised.** An uncaught exception in a page script
  // is always ours; a console *error* is only ours when it came from a
  // script on our own origin, and the ones that do not are third-party
  // noise a diver's browser makes too — a blocked map iframe, a font host
  // the runner cannot reach. Counting those would file the same
  // `console-error` issue every Monday about somebody else's network.
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/Failed to load resource|net::ERR_/.test(message.text())) return;
    if (HARNESS_NOISE.test(message.text())) return;
    if (originOf(message.location()?.url) !== OWN_ORIGIN) return;
    consoleErrors.push(message.text());
  });

  const record = (probe: string, detail: string, impact?: string) => {
    findings.push({ probe, path: visit.path, personas: visit.personas, detail, impact });
  };

  let rendered = false;
  try {
    const response = await page.goto(visit.path, { waitUntil: "load" });
    const status = response?.status() ?? 0;
    // A **refusal** surface is asked for nothing but that it render: a
    // `notFound()` reached from inside a streamed segment cannot change a
    // status line that has already been sent, so the dead-link page answers
    // 200 and says its piece in the body. Measured on the first dry run,
    // where `/s/blue-mantis/trips/<a uuid nobody owns>` came back 200 with a
    // React 419 in the console — the streaming shape of `notFound()`, not a
    // defect, and a probe that reported it every Monday would be wrong every
    // Monday.
    if (!visit.refusal && status !== 200) {
      record(
        "page-error",
        `HTTP ${status} where 200 was expected.`,
        status >= 500 ? "critical" : "serious",
      );
    }
    // A document with a title is the settled-document signal `e2e/a11y.spec.ts`
    // gates its own scan on; without it axe reads a half-streamed page and
    // reports `document-title` about a state nobody sees.
    await expect(page).toHaveTitle(/.+/);
    await settlePaint(page);
    rendered = true;
  } catch (error) {
    // A navigation that threw is Leo's finding, not a broken run: a page that
    // will not load on a warm server is exactly what the walk is looking for.
    // Unless the tab itself went away, which is the machine rather than the
    // page and belongs to the retry above.
    if (TARGET_GONE.test(String(error))) throw error;
    record("page-error", `The page did not load: ${short(error)}`, "critical");
  }

  if (rendered) {
    await scanWithAxe(page, record);
    await probeSkipLink(page, record);
    await probeMessageKeys(page, record);
    await probeShopIdentity(page, visit.path, record);
  }

  if (consoleErrors.length > 0 && !visit.refusal) {
    record("console-error", `${consoleErrors.length}: ${short(consoleErrors[0])}`, "serious");
  }
  await page.close().catch(() => undefined);
}

/** The origin the walk's own server answers on, parsed once. */
const OWN_ORIGIN = new URL(PERSONA_BASE_URL).origin;

/**
 * The origin of a URL, or `null` when it does not parse.
 *
 * Parsed and compared whole rather than tested with `startsWith`/`includes`:
 * a substring test on a URL matches the host anywhere in the string, so
 * `https://evil.example/?http://127.0.0.1:25438` would read as ours. Nothing
 * here is security-relevant — the question is only whose script logged an
 * error — but this repository has had three CodeQL alerts from exactly that
 * habit in one file, and the habit is the thing worth not keeping.
 */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** A tab, a context or the browser itself going away underneath the walk. */
const TARGET_GONE =
  /Target (?:page, context or browser|closed)|has been closed|browser has crashed/i;

/** Throw the cached context away, so the retry gets a clean one (and a fresh sign-in). */
async function dropContext(as: string | null, locale: string) {
  const key = `${as ?? "anon"}|${locale}`;
  const context = contexts.get(key);
  contexts.delete(key);
  await context?.close().catch(() => undefined);
}

/**
 * The last step of the run: photograph the surfaces behind the findings that
 * can actually be filed, through `scripts/screenshot.mjs` — the repository's
 * kept capture tool — rather than a driver written here.
 *
 * One process per surface, bounded, and a failure is skipped rather than
 * fatal: `screenshot.mjs` refuses a page whose `<main>` is too thin to be
 * anything but a skeleton, and some of the surfaces the walk finds defects on
 * are exactly that. An issue that names its surfaces is still worth filing
 * without a picture of them.
 */
test("photograph the surfaces the findings name", async () => {
  // **Opt-in, and byte-identical to the old behaviour when it is off.** The
  // judged pass reads the stops its two personas made, whether or not a lens
  // fired there, so the pictures have to exist before it runs — but a picture
  // is a whole `screenshot.mjs` process, and the Monday cron does not pass the
  // flag.
  const judging = process.env.PERSONA_BOTS_JUDGE === "1";
  const cap = judging ? SCREENSHOT_CAP + JUDGED_SCREENSHOT_CAP : SCREENSHOT_CAP;
  // Its own budget rather than the per-visit one: this is up to `cap` separate
  // `screenshot.mjs` processes, each with a browser and a sign-in of its own
  // and each already bounded by `runBounded`.
  test.setTimeout(cap * SUBPROCESS_TIMEOUTS.nodeScript + 60_000);
  // A capture is a (path, role) pair rather than a path. `screenshot.mjs`
  // signs in as the owner unless told otherwise, and Kai's whole lens is the
  // *fewest* permissions: judging his refusal against a picture of the owner's
  // view of the same URL would file findings about a page he cannot see.
  const wanted: { path: string; as: string | null }[] = [];
  const already = (urlPath: string, as: string | null) =>
    wanted.some((capture) => capture.path === urlPath && capture.as === as);
  if (judging) {
    // Seeded *before* the finding-derived list, deliberately: a judged stop with
    // no picture is a persona the pass cannot read at all, while a mechanical
    // finding with no picture still files an issue naming its surfaces.
    for (const visit of walkPlan()) {
      if (!visit.personas.some((id: string) => JUDGE_PERSONAS.includes(id))) continue;
      if (judgeStops.some((stop) => stop.path === visit.path && stop.as === visit.as)) continue;
      judgeStops.push({
        path: visit.path,
        personas: visit.personas.filter((id: string) => JUDGE_PERSONAS.includes(id)),
        as: visit.as,
        locale: visit.locale,
      });
      if (!already(visit.path, visit.as) && wanted.length < cap)
        wanted.push({ path: visit.path, as: visit.as });
    }
  }
  for (const entry of classify(findings)) {
    for (const surface of entry.surfaces) {
      if (!already(surface.path, null) && wanted.length < cap)
        wanted.push({ path: surface.path, as: null });
    }
  }
  for (const capture of wanted) {
    const result = runBounded(
      process.execPath,
      [
        path.resolve(__dirname, "../screenshot.mjs"),
        "--base",
        PERSONA_BASE_URL,
        "--out",
        PERSONA_OUT_DIR,
        "--light",
        "--width",
        "1280",
        ...(capture.as ? ["--as", capture.as] : []),
        capture.path,
      ],
      {
        timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
        encoding: "utf8",
        cwd: path.resolve(__dirname, "../.."),
      },
    );
    if (result.status !== 0) {
      console.warn(
        `persona-bots: no screenshot for ${capture.path} — ${short(result.stderr ?? "")}`,
      );
      continue;
    }
    const written = String(result.stdout ?? "").match(/(?:wrote|replaced) (\S+\.png)/);
    if (!written) continue;
    const file = path.basename(written[1]);
    // The path-keyed map is what a filed issue's surface line reads, and it
    // stays the owner's picture, exactly as before. A role-specific capture
    // belongs to the judged stop that asked for it and nowhere else.
    if (capture.as === null) screenshots[capture.path] = file;
    for (const stop of judgeStops) {
      if (stop.path === capture.path && stop.as === capture.as) stop.screenshot = file;
    }
  }
  writeFindings();
});

/** The report `scripts/persona-bots.mjs` reads. Rewritten after every visit so a killed run still says what it got. */
function writeFindings() {
  writeFileSync(
    PERSONA_FINDINGS_FILE,
    `${JSON.stringify({ shop: DEMO_SHOP_SLUG, walked, planned: walkPlan().length, findings, screenshots, judgeStops }, null, 2)}\n`,
  );
}

async function openPage(
  browser: import("@playwright/test").Browser,
  as: string | null,
  locale: string,
): Promise<Page> {
  const key = `${as ?? "anon"}|${locale}`;
  let context = contexts.get(key);
  if (!context) {
    context = await browser.newContext({
      locale,
      // The reader's own choice wins over Accept-Language (ADR
      // 20260812-reader-chosen-language), so Ingrid's Spanish has to be the
      // cookie rather than only the header.
      extraHTTPHeaders: { "accept-language": locale },
    });
    await context.addCookies([{ name: "diveday_locale", value: locale, url: PERSONA_BASE_URL }]);
    // The same three the e2e fleet blocks (`e2e/fixtures.ts`), for the same
    // reasons: an aborted map frame is what stops `load` from ever firing on a
    // runner with no route to Google, and a font that arrives after paint
    // changes what `color-contrast` measures.
    await context.route("https://maps.google.com/**", (route) => route.abort());
    await context.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
    await context.route("https://fonts.gstatic.com/**", (route) => route.abort());
    if (as) await signIn(context, as);
    contexts.set(key, context);
  }
  return context.newPage();
}

/** One real sign-in per role, held in that role's context for every surface it visits. */
async function signIn(context: BrowserContext, role: string) {
  const login = DEV_STAFF_LOGINS[role as keyof typeof DEV_STAFF_LOGINS];
  if (!login) throw new Error(`persona-bots: no dev credential for role "${role}"`);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(login.email);
  await page.getByLabel("Password").fill(login.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/shop") || url.searchParams.has("error"));
  if (new URL(page.url()).searchParams.has("error")) {
    throw new Error(`persona-bots: sign-in as ${role} was refused`);
  }
  await page.close();
}

/**
 * A settled paint, not merely a settled document: `color-contrast` measures
 * what is on screen, so an element halfway through an entrance animation is
 * measured at whatever opacity it had reached. Waits on the animations
 * themselves rather than a duration, skipping the infinite ones (skeletons and
 * spinners never finish) — the same barrier `e2e/a11y.spec.ts` uses.
 */
async function settlePaint(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        document.fonts.ready.then(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }),
  );
}

/** June's lens: the same WCAG 2.0 A/AA + 2.2 AA rule set `e2e/a11y.spec.ts` runs, no exclusions. */
async function scanWithAxe(
  page: Page,
  record: (probe: string, detail: string, impact?: string) => void,
) {
  let results: Awaited<ReturnType<AxeBuilder["analyze"]>>;
  try {
    results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
  } catch (error) {
    // A crashed tab belongs to the caller's one retry, not to a warning that
    // leaves the visit looking complete with no scan in it.
    if (TARGET_GONE.test(String(error))) throw error;
    console.warn(`persona-bots: the axe scan did not run — ${short(error)}`);
    return;
  }
  for (const violation of results.violations) {
    const nodes = violation.nodes
      .slice(0, 3)
      .map((node) => node.target.join(" "))
      .join(", ");
    record(
      `axe:${violation.id}`,
      `${violation.nodes.length} node(s): ${nodes}. ${violation.help}.`,
      violation.impact ?? "moderate",
    );
  }
}

/** June's line: every page keeps a skip link. */
async function probeSkipLink(
  page: Page,
  record: (probe: string, detail: string, impact?: string) => void,
) {
  const hasSkipLink = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href^='#']")).some((anchor) =>
      /^#(main|content|skip)/i.test(anchor.getAttribute("href") ?? ""),
    ),
  );
  if (!hasSkipLink) record("skip-link", "No anchor to #main on the page.", "serious");
}

/** Ingrid's line: no reader ever sees a message key where a sentence belongs. */
async function probeMessageKeys(
  page: Page,
  record: (probe: string, detail: string, impact?: string) => void,
) {
  const leaked = await page.evaluate((pattern) => {
    const key = new RegExp(pattern);
    const skip = new Set(["SCRIPT", "STYLE"]);
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (element.children.length > 0 || skip.has(element.tagName)) continue;
      if (element.closest("a, code, pre, kbd, samp")) continue;
      const own = (element.textContent ?? "").trim();
      if (own.length > 0 && key.test(own)) return own;
    }
    return null;
  }, MESSAGE_KEY.source);
  if (leaked)
    record("untranslated-key", `An element reads "${leaked}" where a sentence belongs.`, "serious");
}

/** Tomas's line: an anonymous public page carries the shop's identity, never a bare shell. */
async function probeShopIdentity(
  page: Page,
  urlPath: string,
  record: (probe: string, detail: string, impact?: string) => void,
) {
  if (!urlPath.startsWith(`/s/${DEMO_SHOP_SLUG}`)) return;
  const named = await page.evaluate(
    () => /blue mantis/i.test(document.body.innerText) || /blue mantis/i.test(document.title),
  );
  if (!named) record("shop-identity", "Neither the page nor its title names the shop.", "serious");
}

/**
 * One line of an error, with the template placeholders `check-follow-ups.mjs`
 * refuses stripped out — an assertion message or a page's own text can carry
 * "TODO", and an issue body holding one is refused by the guard rather than
 * filed.
 */
function short(value: unknown): string {
  return String(value instanceof Error ? value.message : value)
    .split("\n")[0]
    .replace(/\b(TODO|TBD)\b/g, "(placeholder)")
    .slice(0, 200);
}
