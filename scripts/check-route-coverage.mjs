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
// So the coverage is checked against the tree. For every `page.tsx` under
// `src/app`, the check works out which specs exercise it and which visual
// captures photograph it, and a route that genuinely warrants less carries an
// `exempt` reason a human had to type:
//
//   - every route has both a spec and a capture, or a written reason;
//   - every hand-written entry still names a real route;
//   - every spec file it names exists under `e2e/`;
//   - every capture name it names appears as `capture(page, "<name>"` in
//     `e2e/visual.spec.ts`.
//
// That first one used to read "a route with *neither* carries a written reason",
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
// ## Derived coverage, and the exceptions written by hand
//
// The ledger used to list every route's specs and captures by hand, so every
// new page touched `scripts/route-coverage.json` — 18 of 322 commits in three
// days, the one file every feature layer of a stack conflicted on (code review
// 2026-10-10, finding 10). Most of that list is mechanical: a spec that visits
// `/shop/blue-mantis/staffing` says so in a string. So the coverage is derived:
//
//   - **a spec covers a route** when its source holds a path literal that
//     resolves to it (`"/shop/blue-mantis/staffing"`, `` `/s/${SHOP}/trips/${id}` ``,
//     or `` `${tripPath}/print` `` where `tripPath` is a path constant in the same
//     file). A `${…}` segment matches a dynamic segment; a literal one prefers a
//     static route over a dynamic sibling (`/gear/rentals` over `/gear/[id]`);
//   - **a capture photographs a route** when the last path literal before its
//     `capture(page, …)` call, inside the same `test(`, resolves to it;
//   - **a spec scans a route** (`a11y`) when it covers the route and calls
//     `expectNoA11yViolations`.
//
// What no string shows is a route reached by clicks: `e2e/waivers.spec.ts`
// reaches `/waivers/[token]` by pressing "Send waiver" and following a toast.
// Guessing those would invent coverage, so they stay in the ledger by hand —
// a `reached` entry naming the specs and captures that land there — beside the
// `exempt` reasons. Nothing else lives in the file; a new route a spec visits
// by URL needs no edit at all.
//
// ## The ratchet (mirrors scripts/check-copy.mjs)
//
// `--write` keeps the file to its exceptions. It drops an entry for a deleted
// route, drops a hand-written name the derivation now finds by itself, and banks
// a closed gap by removing an `exempt` that the route no longer needs. It will
// never ADD an exemption and never REMOVE a name whose spec or capture vanished:
// both of those weaken the gate, so both stay deliberate hand edits that show up
// in review. If a listed
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
  "Only what scripts/check-route-coverage.mjs cannot derive from the tree. A route's specs, captures and a11y scans are read from the path literals in e2e/ (see that script); an entry here adds `e2e` specs and `visual` captures that reach the route by clicks a literal cannot show, `a11y` scans likewise, or an `exempt` reason saying why the route warrants less than both. `node scripts/check-route-coverage.mjs --write` prunes it; it never adds an exemption.";

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

/** Every spec's source, by file name — what the derivation reads. */
export async function collectSpecSources(root, specs) {
  const sources = new Map();
  await Promise.all(
    [...specs].map(async (spec) => {
      sources.set(spec, await readFile(path.join(root, E2E_DIR, spec), "utf8"));
    }),
  );
  return sources;
}

/** Everything the audit and the writer reason over, read from one directory. */
export async function collectWorld(root) {
  const [routes, specs, captures, ledger] = await Promise.all([
    collectRoutes(root),
    collectSpecFiles(root),
    collectCaptureNames(root),
    readLedger(root),
  ]);
  const specSources = await collectSpecSources(root, specs);
  return { routes, specs, captures, ledger, specSources };
}

// ---------------------------------------------------------------------------
// The derivation — pure, exported for the unit test.

/** A quoted path: `"/a/b"`, `'/a'` or `` `/a/${b}` ``, `${…}` allowed anywhere inside. */
const PATH_LITERAL = /(["'`])(\/(?:[^"'`\s\\$]|\$\{[^}]*\}|\$(?!\{))*)\1/g;
/** `const tripPath = `/shop/x/trips/${id}`` — a path constant a later template may start from. */
const PATH_CONSTANT =
  /\b(?:const|let)\s+(\w+)\s*=\s*(["'`])(\/(?:[^"'`\s\\$]|\$\{[^}]*\}|\$(?!\{))*)\2/g;
/** `` `${tripPath}/print` `` — a template that starts from a constant. */
const CONSTANT_PREFIXED = /`\$\{(\w+)\}((?:[^`\s\\$]|\$\{[^}]*\}|\$(?!\{))*)`/g;
/** A `test(` declaration, which bounds the captures a path literal can be credited with. */
const TEST_START = /^\s*test(?:\.(?:only|skip|fixme|fail))?\s*\(/gm;
/** The call that makes a spec an accessibility scan rather than a visit. */
const A11Y_SCAN = /\bexpectNoA11yViolations\s*\(/;

/** A path literal reduced to its route shape: `${…}` becomes `*`, query and hash dropped. */
function pathShape(text) {
  const bare = text.replace(/\$\{[^}]*\}/g, "*").split(/[?#]/)[0];
  if (bare !== "/" && !/^\/[a-z*[]/.test(bare)) return null;
  return bare.length > 1 ? bare.replace(/\/$/, "") : bare;
}

/** Every path literal in a source, with where it starts. */
export function pathLiterals(source) {
  const found = [];
  const constants = new Map();
  for (const match of source.matchAll(PATH_CONSTANT)) constants.set(match[1], match[3]);
  for (const match of source.matchAll(CONSTANT_PREFIXED)) {
    const base = constants.get(match[1]);
    const shape = base === undefined ? null : pathShape(base + match[2]);
    if (shape) found.push({ path: shape, index: match.index });
  }
  for (const match of source.matchAll(PATH_LITERAL)) {
    const shape = pathShape(match[2]);
    if (shape) found.push({ path: shape, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * The routes a path shape resolves to — the best-fitting ones only.
 *
 * Segments must line up one to one. A literal segment fits a static segment
 * of the same name or any dynamic one; a `*` (an interpolation) fits anything.
 * Among the fits, the one with the fewest mismatched kinds wins — a literal
 * landing on a dynamic segment, or a `*` landing on a static one — so
 * `/shop/x/gear/rentals` is the rentals page and `/shop/x/gear/${id}` the unit
 * page, never both.
 */
export function routesForPath(routes, shape) {
  const segments = shape === "/" ? [] : shape.slice(1).split("/");
  let best = [];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const route of routes) {
    const parts = route === "/" ? [] : route.slice(1).split("/");
    if (parts.length !== segments.length) continue;
    let score = 0;
    let fits = true;
    for (const [i, part] of parts.entries()) {
      const dynamic = part.startsWith("[");
      const wild = segments[i].includes("*");
      if (!dynamic && !wild && part !== segments[i]) {
        fits = false;
        break;
      }
      if (dynamic !== wild) score += 1;
    }
    if (!fits) continue;
    if (score < bestScore) {
      best = [route];
      bestScore = score;
    } else if (score === bestScore) best.push(route);
  }
  return best;
}

/**
 * What the tree says on its own: for every route, the specs whose source
 * reaches it, the captures shot after reaching it within one test, and the
 * scans run on it.
 */
export function deriveCoverage({ routes, specSources = new Map() }) {
  const derived = new Map(
    routes.map((route) => [route, { e2e: new Set(), visual: new Set(), a11y: new Set() }]),
  );
  for (const [spec, source] of specSources) {
    const scans = A11Y_SCAN.test(source);
    for (const { path: shape } of pathLiterals(source)) {
      for (const route of routesForPath(routes, shape)) {
        derived.get(route).e2e.add(spec);
        if (scans) derived.get(route).a11y.add(spec);
      }
    }
  }
  const visual = specSources.get(path.basename(VISUAL_SPEC));
  if (visual !== undefined) {
    const events = [
      ...[...visual.matchAll(TEST_START)].map((match) => ({ kind: "test", index: match.index })),
      ...pathLiterals(visual).map((literal) => ({ kind: "path", ...literal })),
      ...[...visual.matchAll(/\b(?:capture|capturePrint)\(\s*page\s*,\s*["'`]([^"'`]+)["'`]/g)].map(
        (match) => ({ kind: "capture", name: match[1], index: match.index }),
      ),
    ].sort((a, b) => a.index - b.index);
    let last = null;
    for (const event of events) {
      if (event.kind === "test") last = null;
      else if (event.kind === "path") last = event.path;
      else if (last !== null) {
        for (const route of routesForPath(routes, last)) derived.get(route).visual.add(event.name);
      }
    }
  }
  return derived;
}

/**
 * The whole ledger as consumers read it — every route, its derived and
 * hand-written specs, captures and scans together, and its exemption — the
 * shape `scripts/route-coverage.json` held when every line of it was typed.
 */
export function effectiveLedger(world) {
  const entries = ledgerEntries(world.ledger);
  const derived = deriveCoverage(world);
  const ledger = {};
  for (const route of world.routes) {
    const hand = entries[route];
    const handEntry = hand && typeof hand === "object" && !Array.isArray(hand) ? hand : {};
    const merged = (key) =>
      [...new Set([...derived.get(route)[key], ...list(handEntry[key])])].sort();
    const entry = { e2e: merged("e2e"), visual: merged("visual") };
    const a11y = merged("a11y");
    if (a11y.length > 0) entry.a11y = a11y;
    if (typeof handEntry.exempt === "string" && handEntry.exempt.trim() !== "") {
      entry.exempt = handEntry.exempt;
    }
    ledger[route] = entry;
  }
  return ledger;
}

/** {@link effectiveLedger} for the tree at `root` — what other scripts import. */
export async function loadCoverage(root) {
  return effectiveLedger(await collectWorld(root));
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
export function auditLedger(world) {
  const { routes, ledger, specs, captures } = world;
  const violations = [];
  // A missing ledger is an empty one: nothing written by hand, every route
  // held to what the tree shows.
  const entries = ledgerEntries(ledger);
  const derived = deriveCoverage(world);
  const known = new Set(routes);
  const stats = { total: routes.length, e2e: 0, visual: 0, a11y: 0, exempt: 0, uncovered: 0 };

  for (const route of routes) {
    const entry = entries[route] ?? {};
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      violations.push(
        `${route}: entry must be an object of { e2e?: [], visual?: [], a11y?: [], exempt? }, got ${Array.isArray(entry) ? "an array" : entry === null ? "null" : typeof entry}.`,
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

    // Coverage is what the tree shows plus what the entry adds by hand.
    const { e2e: seenE2e, visual: seenVisual, a11y: seenA11y } = derived.get(route);
    const coveredE2e = seenE2e.size > 0 || e2eNames.length > 0;
    const coveredVisual = seenVisual.size > 0 || visualNames.length > 0;
    if (coveredE2e) stats.e2e += 1;
    if (coveredVisual) stats.visual += 1;
    if (seenA11y.size > 0 || a11yNames.length > 0) stats.a11y += 1;
    const exempt = typeof entry.exempt === "string" && entry.exempt.trim() !== "";

    // **Both, or a written reason.** This used to pass on *either* — so a route
    // could arrive with a spec, no capture and no exemption, and the report line
    // read as a summary rather than a shortfall. Three were in that state
    // (issue #727), including the form the front desk fills in most often and
    // the first screen a new hire ever sees. That fourth state is the one the
    // `exempt` field was invented to make impossible, so it is a failure now:
    // a gap has to be a decision somebody wrote down.
    if (coveredE2e && coveredVisual) {
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
      !coveredE2e && !coveredVisual
        ? "no e2e spec and no visual capture"
        : !coveredE2e
          ? "no e2e spec"
          : "no visual capture";
    violations.push(
      `${route}: ${missing}. Every important flow gets an e2e spec and every important surface gets a capture (AGENTS.md) — add the missing one, or write an \`exempt\` reason saying why this route needs neither. A spec or capture that reaches it only by clicks, which no path literal shows, is named by hand in ${LEDGER_PATH}.`,
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
 * The file holds only exceptions, and the ratchet only turns one way. Dropping
 * a deleted route's entry, dropping hand-written names from a column the
 * derivation already covers for that route, and removing an `exempt` a route has outgrown all leave the gate at
 * least as strong. Dropping a name whose spec or capture vanished does not, so
 * it is a refusal rather than a silent rewrite — `--absorb` accepts it loudly.
 * A new route gets no entry: what the tree shows of it is the whole claim, and
 * the audit fails it until a spec or a written reason arrives.
 */
export function planLedgerWrite(world) {
  const { routes, ledger, specs, captures } = world;
  const entries = ledgerEntries(ledger);
  const derived = deriveCoverage(world);
  const next = {};
  const removedRoutes = [];
  const bankedExemptions = [];
  const derivedNames = [];
  const drops = [];

  for (const route of routes) {
    const existing = entries[route];
    if (existing === undefined || existing === null || typeof existing !== "object") continue;
    const entry = normalizeEntry(existing);
    const seen = derived.get(route);
    const keep = (key, exists, label) => {
      const kept = [];
      for (const name of entry[key] ?? []) {
        if (!exists(name)) drops.push(`${route}: ${label(name)}`);
        // The tree already shows this column for the route, so the gate no
        // longer rests on the hand-written name — the file keeps only gaps.
        else if (seen[key].size > 0) derivedNames.push(`${route}: ${key} "${name}"`);
        else kept.push(name);
      }
      return kept;
    };
    const keptE2e = keep(
      "e2e",
      (spec) => specs.has(spec),
      (spec) => `e2e "${spec}" no longer exists under ${E2E_DIR}/`,
    );
    const keptVisual = keep(
      "visual",
      (name) => captures.has(name),
      (name) => `visual capture "${name}" is no longer shot`,
    );
    // `a11y` names specs too, so a vanished scan is a coverage drop like any
    // other (issue #1362: the column once did not survive a `--write` at all).
    const keptA11y = keep(
      "a11y",
      (spec) => specs.has(spec),
      (spec) => `a11y spec "${spec}" no longer exists under ${E2E_DIR}/`,
    );

    const written = {};
    if (keptE2e.length > 0) written.e2e = keptE2e;
    if (keptVisual.length > 0) written.visual = keptVisual;
    if (keptA11y.length > 0) written.a11y = keptA11y;
    if (entry.exempt !== undefined) {
      // **The same condition the audit banks on, which is `&&`, not `||`**
      // (issue #1362): a route exempt from exactly one half keeps the paragraph
      // explaining why — /shop/[shopSlug]/settings/security has an e2e spec and
      // an argued reason for having no capture.
      const coveredE2e = seen.e2e.size > 0 || entry.e2e.some((spec) => specs.has(spec));
      const coveredVisual = seen.visual.size > 0 || entry.visual.some((name) => captures.has(name));
      if (coveredE2e && coveredVisual) bankedExemptions.push(route);
      else written.exempt = entry.exempt;
    }
    if (Object.keys(written).length > 0) next[route] = written;
  }

  for (const route of Object.keys(entries)) {
    if (!routes.includes(route)) removedRoutes.push(route);
  }

  return { next, removedRoutes, bankedExemptions, derivedNames, drops };
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
  const { routes } = world;

  if (process.argv.includes("--report")) {
    const effective = effectiveLedger(world);
    for (const route of routes) {
      const entry = effective[route];
      const mark = entry.exempt
        ? "EXEMPT"
        : entry.e2e.length + entry.visual.length > 0
          ? "ok"
          : "GAP";
      console.log(`${mark.padEnd(6)} ${route}`);
      if (entry.e2e.length > 0) console.log(`         e2e:    ${entry.e2e.join(", ")}`);
      if (entry.visual.length > 0) console.log(`         visual: ${entry.visual.join(", ")}`);
      if (entry.exempt) console.log(`         exempt: ${entry.exempt}`);
    }
    console.log(`\n${summaryLine(auditLedger(world).stats)}`);
    process.exit(0);
  }

  const absorbing = process.argv.includes("--absorb");
  if (process.argv.includes("--write") || absorbing) {
    const plan = planLedgerWrite(world);
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
    console.log(
      `route-coverage: ledger written — ${Object.keys(plan.next).length} hand-written entries for ${routes.length} routes`,
    );
    for (const route of plan.removedRoutes) console.log(`- ${route}: route gone, entry removed`);
    for (const name of plan.derivedNames)
      console.log(`- ${name}: covered by the tree now, hand entry removed`);
    for (const route of plan.bankedExemptions) {
      console.log(`- ${route}: covered now — exemption banked and removed`);
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
