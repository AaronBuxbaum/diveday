// Route → test-coverage ledger.
//
// AGENTS.md says every important flow a user runs gets an `e2e/` spec and every
// important surface they look at gets a screenshot assertion in
// `e2e/visual.spec.ts`. Nothing enforced it, and the gap was not theoretical: a
// 2026-08-03 evaluation of the test system found three staff pages that had
// shipped with neither — `/shop/[shopSlug]/orders/new`,
// `/shop/[shopSlug]/dive-sites/catalog`, and `/shop/[shopSlug]/staffing`. A page
// with no coverage is silent by construction; it produces no failure to notice.
//
// So the coverage is written down. `scripts/route-coverage.json` names, for every
// `page.tsx` under `src/app`, which specs exercise it and which visual captures
// photograph it — and, for a route that genuinely warrants less, an `exempt`
// reason a human had to type. The check keeps that ledger honest against the tree:
//
//   - every route has an entry, and every entry still names a real route;
//   - every spec file listed exists under `e2e/`;
//   - every capture name listed appears as `capture(page, "<name>"` in
//     `e2e/visual.spec.ts`;
//   - **every route has both a spec and a capture, or a written reason.**
//
// That last one used to read "a route with *neither* carries a written reason",
// which left a fourth state the ledger tolerated in silence: a spec, no capture,
// no exemption. Three routes were in it (issue #727) — the add-diver form the
// front desk fills in most often, the long dive-site form, and `/invite/[token]`,
// the first DiveDay screen a new hire ever sees, which has an `error.tsx` of its
// own and had never been looked at in light or dark. Nothing said so: the report
// line read "66 with a visual capture" as a summary rather than a shortfall.
//
// AGENTS.md asks for both — every important *flow* gets a spec, every important
// *surface* gets a capture — so a route that has one and not the other is a
// decision, and this is where it gets written down.
//
// ## Why the coverage lists are hand-maintained
//
// This deliberately does NOT try to derive "spec X covers route Y" automatically.
// A spec covers a route when it drives a flow that *lands* there, which is mostly
// clicks: `e2e/waivers.spec.ts` reaches `/waivers/[token]` by pressing "Send
// waiver" and following the link out of a toast, and `e2e/visual.spec.ts` reaches
// four trip surfaces through the trip nav. No grep sees that, and a grep that
// guessed would either invent coverage (the dangerous direction) or demand
// exemptions for routes that are in fact well covered (the direction that teaches
// sessions to rubber-stamp exemptions). Both failures are worse than typing the
// spec name.
//
// What *is* mechanical — which routes exist, which spec files exist, which
// captures exist — is derived every run, so the hand-written half can never drift
// into fiction.
//
// ## The ratchet (mirrors scripts/check-copy.mjs)
//
// `--write` regenerates only those mechanical facts. It adds an entry for a new
// route, drops an entry for a deleted one, and banks a closed gap by removing an
// `exempt` that the route no longer needs. It will never ADD an exemption and
// never REMOVE a spec or capture from a route's lists: both of those weaken the
// gate, so both stay deliberate hand edits that show up in review. If a listed
// spec, capture or a11y scan has genuinely vanished, `--write` refuses and says
// so; `--absorb` is the loud escape hatch for the one case that is not new debt
// — a merge from a branch that deleted the spec.
//
// **That paragraph was false for a year, in the two directions it promises
// hardest** (issue #1362). `planLedgerWrite` rebuilt each entry as
// `{ e2e, visual }`, so every `a11y` list — 56 of them — was silently deleted by
// any `--write`; and it banked an exemption whenever *either* a spec or a
// capture survived, where the audit banks only when *both* do, so the one route
// legitimately exempt from half the bar lost its written reason and then failed
// the audit for the half it was exempt from. Both are now pinned by
// `scripts/check-route-coverage.test.ts`, which fails against the old writer.
// The rule this settles: a writer for a hand-maintained ledger carries every
// field it does not itself compute, and a promise about a flag is worth exactly
// as much as the test under it.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const APP_DIR = "src/app";
export const E2E_DIR = "e2e";
export const VISUAL_SPEC = "e2e/visual.spec.ts";
export const LEDGER_PATH = "scripts/route-coverage.json";

export const LEDGER_NOTE =
  "Every `src/app/**/page.tsx` route and the tests that cover it. `e2e` names spec files under e2e/, `visual` names captures in e2e/visual.spec.ts, `a11y` names the specs that run an axe scan on it, `exempt` states why a route warrants less than both. Mechanical facts are written by `node scripts/check-route-coverage.mjs --write`; the coverage lists are hand-maintained on purpose — see scripts/check-route-coverage.mjs.";

// `a11y` is deliberately its own column rather than being read out of `e2e`.
// "a spec navigates through this route" and "an axe scan runs on it" are
// different facts, and conflating them is what let the axe share read as 22%
// while `e2e/a11y.spec.ts` was in fact scanning better than forty routes: the
// share was counting the routes whose `e2e` list happened to name that spec,
// which is a list maintained for a different purpose (issue #1056).
const ENTRY_KEYS = new Set(["e2e", "visual", "a11y", "exempt"]);

// ---------------------------------------------------------------------------
// Enumerating the tree — pure-ish readers, each rooted at a directory so the
// unit test can point them at a fixture instead of the repo.

async function walk(root, relativeDirectory, fileName) {
  let entries;
  try {
    entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, relativePath, fileName)));
    else if (entry.name === fileName) files.push(relativePath);
  }
  return files;
}

/**
 * `src/app/shop/[shopSlug]/staffing/page.tsx` → `/shop/[shopSlug]/staffing`.
 *
 * Route groups (`(marketing)`) and parallel slots (`@modal`) are organisational,
 * not addressable, so they drop out. Dynamic segments stay verbatim — the ledger
 * key should read like the folder a session would go open.
 */
export function routePatternFor(relativeFile) {
  const normalized = relativeFile.split(path.sep).join("/");
  const inner = normalized.replace(/^src\/app\//, "").replace(/\/?page\.tsx$/, "");
  const segments = inner
    .split("/")
    .filter((segment) => segment !== "")
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .filter((segment) => !segment.startsWith("@"));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

export async function collectRoutes(root) {
  const files = await walk(root, APP_DIR, "page.tsx");
  return [...new Set(files.map(routePatternFor))].sort();
}

export async function collectSpecFiles(root) {
  let entries;
  try {
    entries = await readdir(path.join(root, E2E_DIR), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return new Set();
    throw error;
  }
  return new Set(
    entries.filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts")).map((e) => e.name),
  );
}

/**
 * The capture names `e2e/visual.spec.ts` actually shoots.
 *
 * Print-only surfaces use `capturePrint()` because they are rendered with print
 * media. Both helpers produce a baseline name that belongs in the same ledger.
 */
export function parseCaptureNames(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /\b(?:capture|capturePrint)\(\s*page\s*,\s*["'`]([^"'`]+)["'`]/g,
  )) {
    names.add(match[1]);
  }
  return names;
}

export async function collectCaptureNames(root) {
  try {
    return parseCaptureNames(await readFile(path.join(root, VISUAL_SPEC), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return new Set();
    throw error;
  }
}

export async function readLedger(root) {
  try {
    return JSON.parse(await readFile(path.join(root, LEDGER_PATH), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** Everything the audit and the writer reason over, read from one directory. */
export async function collectWorld(root) {
  const [routes, specs, captures, ledger] = await Promise.all([
    collectRoutes(root),
    collectSpecFiles(root),
    collectCaptureNames(root),
    readLedger(root),
  ]);
  return { routes, specs, captures, ledger };
}

/** The ledger's route entries, with the human-facing `//` note filtered out. */
export function ledgerEntries(ledger) {
  return Object.fromEntries(Object.entries(ledger ?? {}).filter(([key]) => !key.startsWith("//")));
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEntry(entry) {
  const next = {
    e2e: [...new Set(list(entry?.e2e))].sort(),
    visual: [...new Set(list(entry?.visual))].sort(),
  };
  // Only when the route has one: an empty `a11y: []` on every route would read
  // as a checklist somebody is expected to tick, which is the ratchet this
  // change deliberately does not create.
  const a11y = [...new Set(list(entry?.a11y))].sort();
  if (a11y.length > 0) next.a11y = a11y;
  if (typeof entry?.exempt === "string" && entry.exempt.trim() !== "") next.exempt = entry.exempt;
  return next;
}

// ---------------------------------------------------------------------------
// The audit — pure, exported for the unit test.

/**
 * Reads the ledger against the tree and returns every way the two disagree.
 * Never throws on a malformed entry: a broken shape is itself a violation with a
 * message, because a check that crashes teaches nothing.
 */
export function auditLedger({ routes, ledger, specs, captures }) {
  const violations = [];
  if (ledger === null || ledger === undefined) {
    return {
      violations: [
        `${LEDGER_PATH} is missing. Create it with \`node scripts/check-route-coverage.mjs --write\`, then fill in the coverage by hand.`,
      ],
      stats: {
        total: routes.length,
        e2e: 0,
        visual: 0,
        a11y: 0,
        exempt: 0,
        uncovered: routes.length,
      },
    };
  }

  const entries = ledgerEntries(ledger);
  const known = new Set(routes);
  const stats = { total: routes.length, e2e: 0, visual: 0, a11y: 0, exempt: 0, uncovered: 0 };

  for (const route of routes) {
    const entry = entries[route];
    if (entry === undefined) {
      violations.push(
        `${route}: no entry in ${LEDGER_PATH}. Add one naming the specs and captures that cover it (\`node scripts/check-route-coverage.mjs --write\` stubs it), or state why it needs neither.`,
      );
      stats.uncovered += 1;
      continue;
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      violations.push(
        `${route}: entry must be an object of { e2e: [], visual: [], exempt? }, got ${Array.isArray(entry) ? "an array" : typeof entry}.`,
      );
      continue;
    }

    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) {
        violations.push(`${route}: unknown key "${key}" — expected e2e, visual, a11y, or exempt.`);
      }
    }
    for (const key of ["e2e", "visual", "a11y"]) {
      if (entry[key] !== undefined && !Array.isArray(entry[key])) {
        violations.push(`${route}: "${key}" must be an array of names.`);
      }
    }
    if (entry.exempt !== undefined && (typeof entry.exempt !== "string" || !entry.exempt.trim())) {
      violations.push(`${route}: "exempt" must be a non-empty reason string.`);
    }

    const e2eNames = list(entry.e2e);
    const visualNames = list(entry.visual);
    const a11yNames = list(entry.a11y);

    for (const spec of e2eNames) {
      if (!specs.has(spec)) {
        violations.push(
          `${route}: names e2e spec "${spec}", which does not exist under ${E2E_DIR}/. Fix the name, or restore the coverage this route lost.`,
        );
      }
    }
    // Same rule as `e2e`: a named spec has to exist. This column never becomes
    // a *requirement* — a route with no scan is not a violation, because
    // whether accessibility coverage is a ratchet is a human decision and not
    // an agent's to impose (issue #1056).
    for (const spec of a11yNames) {
      if (!specs.has(spec)) {
        violations.push(
          `${route}: names a11y spec "${spec}", which does not exist under ${E2E_DIR}/. Fix the name, or restore the scan this route lost.`,
        );
      }
    }
    for (const name of visualNames) {
      if (!captures.has(name)) {
        violations.push(
          `${route}: names visual capture "${name}", which no ${VISUAL_SPEC} \`capture(page, "…"\` call produces. Fix the name, or restore the capture this route lost.`,
        );
      }
    }

    if (e2eNames.length > 0) stats.e2e += 1;
    if (visualNames.length > 0) stats.visual += 1;
    if (a11yNames.length > 0) stats.a11y += 1;
    const exempt = typeof entry.exempt === "string" && entry.exempt.trim() !== "";

    // **Both, or a written reason.** This used to pass on *either* — so a route
    // could arrive with a spec, no capture and no exemption, and the report line
    // read as a summary rather than a shortfall. Three were in that state
    // (issue #727), including the form the front desk fills in most often and
    // the first screen a new hire ever sees. That fourth state is the one the
    // `exempt` field was invented to make impossible, so it is a failure now:
    // a gap has to be a decision somebody wrote down.
    if (e2eNames.length > 0 && visualNames.length > 0) {
      if (exempt) {
        violations.push(
          `${route}: covered now, but still carries an \`exempt\` reason. Bank the closed gap — \`node scripts/check-route-coverage.mjs --write\` removes it.`,
        );
      }
      continue;
    }

    if (exempt) {
      stats.exempt += 1;
      continue;
    }
    stats.uncovered += 1;
    const missing =
      e2eNames.length === 0 && visualNames.length === 0
        ? "no e2e spec and no visual capture"
        : e2eNames.length === 0
          ? "no e2e spec"
          : "no visual capture";
    violations.push(
      `${route}: ${missing}. Every important flow gets an e2e spec and every important surface gets a capture (AGENTS.md) — add the missing one, or write an \`exempt\` reason saying why this route needs neither.`,
    );
  }

  for (const route of Object.keys(entries)) {
    if (!known.has(route)) {
      violations.push(
        `${route}: listed in ${LEDGER_PATH} but no \`${APP_DIR}${route === "/" ? "" : route}/page.tsx\` exists. Remove the stale entry (\`node scripts/check-route-coverage.mjs --write\`).`,
      );
    }
  }

  return { violations, stats };
}

// ---------------------------------------------------------------------------
// The writer — pure, exported for the unit test.

/**
 * What `--write` would put on disk, and every reason it should refuse first.
 *
 * The ratchet only turns one way. Adding a route entry, dropping a deleted
 * route's entry, and removing an `exempt` a route has outgrown all leave the gate
 * at least as strong. Dropping a spec or capture from a route's list does not, so
 * it is a refusal rather than a silent rewrite — `--absorb` accepts it loudly.
 */
export function planLedgerWrite({ routes, ledger, specs, captures }) {
  const entries = ledgerEntries(ledger);
  const next = {};
  const added = [];
  const removedRoutes = [];
  const bankedExemptions = [];
  const drops = [];

  for (const route of routes) {
    const existing = entries[route];
    if (existing === undefined || existing === null || typeof existing !== "object") {
      // A new route starts with nothing claimed and — deliberately — no
      // exemption. The check fails until a human either writes a spec or types
      // the reason it needs none.
      next[route] = { e2e: [], visual: [] };
      added.push(route);
      continue;
    }

    const entry = normalizeEntry(existing);
    const keptE2e = entry.e2e.filter((spec) => specs.has(spec));
    const keptVisual = entry.visual.filter((name) => captures.has(name));
    // `a11y` names specs too, so a vanished scan is a coverage drop like any
    // other. It was neither filtered nor carried through before, which is the
    // sharper half of the same omission: the column simply did not survive a
    // `--write` at all.
    const keptA11y = (entry.a11y ?? []).filter((spec) => specs.has(spec));
    for (const spec of entry.e2e) {
      if (!specs.has(spec))
        drops.push(`${route}: e2e "${spec}" no longer exists under ${E2E_DIR}/`);
    }
    for (const name of entry.visual) {
      if (!captures.has(name)) drops.push(`${route}: visual capture "${name}" is no longer shot`);
    }
    for (const spec of entry.a11y ?? []) {
      if (!specs.has(spec))
        drops.push(`${route}: a11y spec "${spec}" no longer exists under ${E2E_DIR}/`);
    }

    const written = { e2e: keptE2e, visual: keptVisual };
    if (keptA11y.length > 0) written.a11y = keptA11y;
    if (entry.exempt !== undefined) {
      // **The same condition the audit banks on, which is `&&`, not `||`.**
      // The audit calls a route covered only when it has both a spec and a
      // capture; this asked for either, so a route exempt from exactly one half
      // lost the paragraph explaining why — and then failed the audit for the
      // half it was exempt from, with the reason deleted. Exactly one route is
      // in that state and it is the one whose exemption is hardest to re-derive:
      // /shop/[shopSlug]/settings/security has an e2e spec and an argued reason
      // for having no capture.
      if (keptE2e.length > 0 && keptVisual.length > 0) bankedExemptions.push(route);
      else written.exempt = entry.exempt;
    }
    next[route] = written;
  }

  for (const route of Object.keys(entries)) {
    if (!routes.includes(route)) removedRoutes.push(route);
  }

  return { next, added, removedRoutes, bankedExemptions, drops };
}

/**
 * Serializes the ledger the way Biome formats JSON, so `--write` output is
 * already lint-clean and a session never has to run the formatter to land a
 * regenerated file: objects stay expanded, and an array collapses onto one line
 * when it fits inside the configured 100-column width.
 */
const LINE_WIDTH = 100;

/**
 * One array, inline when the whole `"key": [...]` line fits and wrapped
 * one-element-per-line when it doesn't — the wrapped elements indent from the
 * key's own column, not from where the value happens to start.
 */
function serializeArray(values, keyIndent, columnWhereValueStarts) {
  const inline = `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
  if (columnWhereValueStarts + inline.length <= LINE_WIDTH) return inline;
  const pad = " ".repeat(keyIndent + 2);
  const items = values.map((value) => `${pad}${JSON.stringify(value)}`).join(",\n");
  return `[\n${items}\n${" ".repeat(keyIndent)}]`;
}

function serializeEntry(entry, indent) {
  const keyIndent = indent + 2;
  const pad = " ".repeat(keyIndent);
  // `a11y` sits between them because that is the ledger's own reading order,
  // and because it was missing here too (issue #1362): the writer dropped the
  // column and the serializer could not have written it back if it had not.
  const fields = ["e2e", "visual", "a11y", "exempt"]
    .filter((key) => entry[key] !== undefined)
    .map((key) => {
      const prefix = `${pad}${JSON.stringify(key)}: `;
      const value = Array.isArray(entry[key])
        ? serializeArray(entry[key], keyIndent, prefix.length)
        : JSON.stringify(entry[key]);
      return `${prefix}${value}`;
    });
  return `{\n${fields.join(",\n")}\n${" ".repeat(indent)}}`;
}

export function serializeLedger(next) {
  const rows = Object.entries(next)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([route, entry]) => `  ${JSON.stringify(route)}: ${serializeEntry(entry, 2)}`);
  return `{\n  "//": ${JSON.stringify(LEDGER_NOTE)},\n${rows.join(",\n")}\n}\n`;
}

export function summaryLine(stats) {
  return `route-coverage: ${stats.total} routes — ${stats.e2e} with an e2e spec, ${stats.visual} with a visual capture, ${stats.exempt} exempt with a stated reason`;
}

// ---------------------------------------------------------------------------
// CLI

async function main() {
  const world = await collectWorld(ROOT);
  const { routes, specs, captures, ledger } = world;

  if (process.argv.includes("--report")) {
    const entries = ledgerEntries(ledger);
    for (const route of routes) {
      const entry = entries[route] ?? {};
      const e2e = list(entry.e2e);
      const visual = list(entry.visual);
      const mark = entry.exempt ? "EXEMPT" : e2e.length + visual.length > 0 ? "ok" : "GAP";
      console.log(`${mark.padEnd(6)} ${route}`);
      if (e2e.length > 0) console.log(`         e2e:    ${e2e.join(", ")}`);
      if (visual.length > 0) console.log(`         visual: ${visual.join(", ")}`);
      if (entry.exempt) console.log(`         exempt: ${entry.exempt}`);
    }
    console.log(`\n${summaryLine(auditLedger(world).stats)}`);
    process.exit(0);
  }

  const absorbing = process.argv.includes("--absorb");
  if (process.argv.includes("--write") || absorbing) {
    const plan = planLedgerWrite({ routes, ledger, specs, captures });
    if (plan.drops.length > 0 && !absorbing) {
      console.error(
        "Refusing to write a ledger that drops coverage. The ratchet only turns one way:",
      );
      for (const drop of plan.drops) console.error(`- ${drop}`);
      console.error(
        "Restore the spec or capture, or fix the name by hand. If the deletion arrived in a merge from a branch that predates this check, `--absorb` records it explicitly.",
      );
      process.exit(1);
    }
    if (plan.drops.length > 0) {
      console.warn("Absorbing dropped coverage — this must be merged-in work, not a regression:");
      for (const drop of plan.drops) console.warn(`- ${drop}`);
    }
    await writeFile(path.join(ROOT, LEDGER_PATH), serializeLedger(plan.next));
    console.log(`route-coverage: ledger written — ${routes.length} routes`);
    for (const route of plan.added) {
      console.log(`- ${route}: new route, stubbed with no coverage — name its specs and captures`);
    }
    for (const route of plan.removedRoutes) console.log(`- ${route}: route gone, entry removed`);
    for (const route of plan.bankedExemptions) {
      console.log(`- ${route}: covered now — exemption banked and removed`);
    }
    if (plan.added.length > 0) {
      console.log(
        "No exemption was added for any of the above: `--write` never writes one. If a route truly needs neither an e2e spec nor a capture, type the reason into the ledger by hand.",
      );
    }
    process.exit(0);
  }

  const { violations, stats } = auditLedger(world);
  if (violations.length > 0) {
    console.error(
      `Route coverage ledger violations:\n${violations.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      `Every route in ${APP_DIR} is listed in ${LEDGER_PATH} with the specs and captures that cover it. See the e2e-and-visual skill for what to write.`,
    );
    process.exit(1);
  }

  console.log(summaryLine(stats));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
