#!/usr/bin/env node
import { appendFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Deals the functional Playwright specs onto shards by *cost* rather than by
 * test count.
 *
 * Playwright's `--shard=i/N` sorts the test list and cuts it into N equal-count
 * contiguous groups. The tests are nothing like equal cost: a spec that mints a
 * private shop pays ~1.5s for the mint plus ~1.5s for the sign-in *per test*
 * (`privateShop` in e2e/fixtures.ts), and a spec that drives several roles
 * through a booking flow costs more again than one that asserts on a rendered
 * page. Because the groups are contiguous, a cluster of expensive specs lands
 * whole in one shard — and the run finishes when that shard does. On the green
 * main run of 2026-08-31 the four shards took 4:09, 4:58, 4:38 and **7:39**
 * with 124 or 125 tests each: three and a half minutes of the run's wall-clock
 * was the other three shards idle.
 *
 * The unit suite already solved this (`src/test/shard-sequencer.ts`, whose
 * estimate-and-greedy-partition shape this follows); replayed against real
 * durations it pulled four bins from 176-326s to 226-257s. Playwright has no
 * sequencer extension point, so the same deal is computed here and the file
 * list is passed to `playwright test` explicitly, with no `--shard` at all.
 *
 * ## Recorded durations first, the estimate for what is new
 *
 * Every shard computes the identical partition from the same tree — the
 * property that matters more than accuracy, since a deal two jobs disagreed
 * about would run a spec twice or not at all, and the second failure is
 * silent. So the weights come only from committed files: a spec weighs what it
 * last took on CI, read from `scripts/e2e-durations.json` (refreshed weekly by
 * `.github/workflows/durations-refresh.yml` from the `e2e-durations-<n>` and
 * `visual-durations-<n>` artifacts, `scripts/e2e-durations.mjs`), and a spec
 * that file does not name yet weighs its source estimate scaled into
 * milliseconds by the ratio the recorded specs show — the same rule as the
 * unit sequencer's `weigh` (src/test/shard-sequencer.ts). The estimate alone
 * left the four shards at 477-668s on run 4553 (2026-10-10).
 *
 * ## The visual captures
 *
 * `e2e/visual.spec.ts` is one file of ~550 tests, so it is dealt by *test*
 * rather than by file: `--visual=<list.json>` reads Playwright's own
 * `--list --reporter=json` output (so every shard sees the same test list
 * Playwright will run) and prints this shard's tests as `--test-list` lines.
 * Playwright's index `--shard` cut it into eight equal-count slices that ran
 * 287-529s on the same run. A capture with no recorded duration weighs the
 * mean of the recorded ones — a source estimate (captures per test, the
 * budget, the seeding calls) was tried against that run's eight shard times
 * and none of them correlated, so the mean is the honest prior.
 */

const SPEC_ROOT = "e2e";

/**
 * Never a functional spec — `visual.spec.ts` is dealt by test onto its own
 * eight shards (`--visual`) and has its own baseline plumbing.
 */
export const EXCLUDED_SPECS = ["e2e/visual.spec.ts"];

/** One `test(`/`it(` per test, including modifiers and `.each` tables (counted
 *  once — the table's rows are not worth parsing for). */
const TEST_DECLARATION =
  /^\s*(?:test|it)(?:\.(?:each|skip|only|fixme|fail|concurrent)(?:\([^)]*\))?)*\s*\(/gm;

/**
 * `test.` statics that declare no test of their own — a grouping, a hook, a
 * per-file option, or a step inside a test that is already counted. Stripped
 * before counting, because the alternation above would otherwise read
 * `test.step(` and `test.use(` as tests.
 *
 * Validated against `playwright test --list` on 2026-09-02: **77 of 78 specs
 * match Playwright's own count exactly.** The one that does not is
 * `a11y.spec.ts`, where a `for` loop declares one `test(` that Playwright
 * expands into three — a shape no static read can see, the same limit
 * `src/test/shard-sequencer.ts` accepts for `.each` tables. It costs two units
 * of 27,000, and the greedy deal absorbs it.
 */
const NON_TEST_STATIC =
  /^\s*test\.(?:describe|step|use|configure|slow|setTimeout|before[A-Z]\w*|after[A-Z]\w*)\b/gm;

/**
 * A spec that mints a whole shop of its own. Every test in the file pays the
 * mint and the sign-in, and the teardown drops the shop again — by far the
 * largest per-test constant in the suite (ADR 20260815-per-test-private-shops).
 */
const PRIVATE_SHOP = /\bprivateShop\b/;

/**
 * A spec that signs in as more than one role. Each distinct role costs one
 * sign-in the first time a worker requests it (`staffStorageState` caches per
 * worker), so a file exercising three roles pays three.
 */
const SIGNED_IN_AS = /\bsignedInAs(?:Owner)?\s*\(\s*(?:"([a-z]+)"|'([a-z]+)')?\s*\)/g;

/** Per-test cost, in arbitrary units that only have to be right relative to each other. */
export const PER_TEST_COST = 100;
export const PER_TEST_PRIVATE_SHOP_COST = 300;
/** Per-file overhead: worker start, server and database per worker, the shell. */
export const PER_FILE_COST = 200;
/** Each distinct role a file signs in as, paid once per worker. */
export const PER_ROLE_COST = 150;

/** A static cost estimate for one spec's source. */
export function estimateCost(source) {
  const declarations = source.replace(NON_TEST_STATIC, "");
  const tests = declarations.match(TEST_DECLARATION)?.length ?? 0;
  const roles = new Set();
  for (const match of source.matchAll(SIGNED_IN_AS)) {
    // `signedInAsOwner()` matches with no captured group.
    roles.add(match[1] ?? match[2] ?? "owner");
  }
  const perTest = PRIVATE_SHOP.test(source)
    ? PER_TEST_COST + PER_TEST_PRIVATE_SHOP_COST
    : PER_TEST_COST;
  return PER_FILE_COST + tests * perTest + roles.size * PER_ROLE_COST;
}

/**
 * Deals `items` onto `count` bins, heaviest first onto the emptiest bin, and
 * returns every bin.
 *
 * Deterministic for a given input order: ties on weight keep the caller's
 * order, ties on load go to the lowest-numbered bin. The caller sorts by path
 * first, so every shard sees the same sequence and computes the same deal.
 */
export function partition(items, count) {
  const bins = Array.from({ length: count }, () => ({ load: 0, items: [] }));
  const byWeight = items
    .map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
  for (const { item, weight } of byWeight) {
    let lightest = bins[0];
    for (const bin of bins) if (bin.load < lightest.load) lightest = bin;
    lightest.load += weight;
    lightest.items.push(item);
  }
  // Within a bin, path order — the deal decides *which* shard runs a spec, and
  // Playwright decides the order inside it. A stable listing also keeps the
  // workflow log readable across runs.
  for (const bin of bins) bin.items.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return bins;
}

/**
 * Every functional spec under `e2e/`, path-sorted.
 *
 * Recursive, matching `playwright.config.ts`'s own discovery under `testDir`.
 * A flat `e2e/*.spec.ts` glob would silently skip a spec in a subdirectory
 * while it still ran locally — the failure the workflow's own `globstar` note
 * warns about.
 */
export async function listSpecs(root = process.cwd()) {
  const found = [];
  async function walk(relativeDirectory) {
    let entries;
    try {
      entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await walk(relativePath);
      else if (entry.name.endsWith(".spec.ts") && !EXCLUDED_SPECS.includes(relativePath)) {
        found.push(relativePath);
      }
    }
  }
  await walk(SPEC_ROOT);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Where the recorded durations live, relative to the repository root. */
export const DURATIONS_FILE = "scripts/e2e-durations.json";

/**
 * The committed durations, `{ functional, visual }`, each a map of key →
 * milliseconds. A missing or unreadable file is not an error: the estimate
 * alone still produces a valid partition, just a less even one.
 */
export async function readDurations(root = process.cwd()) {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, DURATIONS_FILE), "utf8"));
    return {
      functional: durationMap(parsed?.functional),
      visual: durationMap(parsed?.visual),
    };
  } catch {
    return { functional: {}, visual: {} };
  }
}

function durationMap(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, ms]) => isDuration(ms)));
}

function isDuration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Weighs each item by its recorded duration when there is one, and by its
 * estimate scaled into milliseconds when there is not. The scale is recorded
 * milliseconds over estimated units across the items that have both, so a new
 * spec lands on the same axis as its neighbours. With nothing recorded the
 * scale is 1 and this is exactly the estimate.
 */
export function weigh(items, durations) {
  let recorded = 0;
  let estimated = 0;
  for (const { key, estimate } of items) {
    if (isDuration(durations[key])) {
      recorded += durations[key];
      estimated += estimate;
    }
  }
  const scale = recorded > 0 && estimated > 0 ? recorded / estimated : 1;
  return items.map(({ item, key, estimate }) => ({
    item,
    weight: isDuration(durations[key]) ? durations[key] : estimate * scale,
  }));
}

/**
 * The full deal: `count` bins of spec paths, computed from the tree at `root`
 * and the committed functional durations (or the ones passed in).
 */
export async function dealSpecs(count, root = process.cwd(), durations) {
  const specs = await listSpecs(root);
  const recorded = durations ?? (await readDurations(root)).functional;
  const estimated = await Promise.all(
    specs.map(async (spec) => ({
      item: spec,
      key: spec,
      estimate: estimateCost(await readSource(path.join(root, spec))),
    })),
  );
  return partition(weigh(estimated, recorded), count);
}

/**
 * Playwright's `--test-list` line for one test: its file, relative to the
 * config's `rootDir`, then every title down to the test's own, joined by `›`.
 * The same string keys the test's recorded duration.
 *
 * Playwright splits each line on `›` and trims every piece, so a title that
 * carries a `›` or starts or ends with a space cannot be named in a test list.
 * Refused here, loudly: the alternative is a test no shard ever selects — a
 * green run over a capture that never ran.
 */
export function testListLine(file, titles) {
  for (const title of titles) {
    if (title.includes("›") || title !== title.trim() || title === "") {
      throw new Error(
        `e2e-shard: the test title ${JSON.stringify(title)} in ${file} cannot be named in a Playwright --test-list (no "›", no leading or trailing space). Rename it.`,
      );
    }
  }
  return [file, ...titles].join(" › ");
}

/**
 * Every test in a `playwright test --list --reporter=json` report, as
 * `--test-list` lines, in the report's own order. One line per test *per
 * project* would need the project prefix; this suite has one project, and a
 * second is refused rather than silently dealt twice.
 */
export function listedTests(report) {
  const projects = new Set();
  const lines = [];
  function walk(suite, titles, file) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) projects.add(test.projectName ?? "");
      lines.push(testListLine(file, [...titles, spec.title]));
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title], file);
  }
  for (const suite of report?.suites ?? []) walk({ ...suite, specs: suite.specs }, [], suite.file);
  if (projects.size > 1) {
    throw new Error(
      `e2e-shard: the visual list spans ${projects.size} projects (${[...projects].join(", ")}); deal one project per run.`,
    );
  }
  if (new Set(lines).size !== lines.length) {
    throw new Error(
      "e2e-shard: two visual tests share one title path; a --test-list cannot tell them apart.",
    );
  }
  return lines;
}

/**
 * The visual deal: `count` bins of `--test-list` lines. A test with a
 * recorded duration weighs it; one without weighs the mean of the recorded
 * ones (1 when nothing is recorded, which deals by count).
 */
export function dealVisualTests(report, count, durations = {}) {
  const lines = listedTests(report);
  const known = lines.map((line) => durations[line]).filter(isDuration);
  const prior = known.length > 0 ? known.reduce((sum, ms) => sum + ms, 0) / known.length : 1;
  return partition(
    lines.map((line) => ({
      item: line,
      weight: isDuration(durations[line]) ? durations[line] : prior,
    })),
    count,
  );
}

/**
 * The deal as a Markdown table for the job summary: every bin's weight, its
 * size, and how far it sits from the heaviest — the number to read first when
 * one shard is slow again.
 */
export function summarizeBins(bins, { title, shard, unit = "ms", recordedShare }) {
  const loads = bins.map((bin) => bin.load);
  const max = Math.max(...loads);
  const min = Math.min(...loads);
  const spread = max > 0 ? (max - min) / max : 0;
  const seconds = (load) =>
    unit === "ms" ? `${(load / 1000).toFixed(1)}s` : `${Math.round(load)}`;
  const rows = bins.map(
    (bin, index) =>
      `| ${index + 1 === shard ? `**${index + 1}**` : index + 1} | ${seconds(bin.load)} | ${bin.items.length} |`,
  );
  const share =
    recordedShare === undefined ? "" : ` · ${Math.round(recordedShare * 100)}% of items recorded`;
  return [
    `### ${title}`,
    "",
    `Spread ${(spread * 100).toFixed(1)}% between the lightest and heaviest bin${share}.`,
    "",
    "| Shard | Weight | Items |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

async function readSource(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    // A spec that cannot be read still has to land in exactly one bin. Give it
    // the bare per-file weight and let the run report the real error.
    return "";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const shardArg = option("shard");
  if (!shardArg) {
    console.error(
      "usage: node scripts/e2e-shard.mjs --shard=<index>/<count> [--visual=<playwright --list json>] [--explain] [--summary=<file>]",
    );
    process.exit(2);
  }
  const [index, count] = shardArg.split("/").map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) {
    console.error(`e2e-shard: --shard must be <index>/<count> with 1 <= index <= count`);
    process.exit(2);
  }

  const durations = await readDurations();
  const visualList = option("visual");
  let bins;
  let recordedShare;
  if (visualList) {
    const report = JSON.parse(await readFile(visualList, "utf8"));
    bins = dealVisualTests(report, count, durations.visual);
    const items = bins.flatMap((bin) => bin.items);
    recordedShare =
      items.filter((line) => isDuration(durations.visual[line])).length / items.length;
  } else {
    bins = await dealSpecs(count, process.cwd(), durations.functional);
    const items = bins.flatMap((bin) => bin.items);
    recordedShare =
      items.filter((spec) => isDuration(durations.functional[spec])).length / items.length;
  }

  if (bins[index - 1].items.length === 0) {
    // An empty shard would pass over nothing; Playwright with no file
    // arguments would instead run *everything*. Neither is a deal.
    console.error(`e2e-shard: shard ${index}/${count} drew nothing — fewer items than shards?`);
    process.exit(1);
  }

  if (args.includes("--explain")) {
    // The whole deal, for reading a slow run afterwards. Stderr, so `--explain`
    // can be added to the workflow command without the listing reaching
    // Playwright's argument list.
    for (const [i, bin] of bins.entries()) {
      console.error(
        `shard ${i + 1}/${count}  weight ${Math.round(bin.load)}  ${bin.items.length} ${visualList ? "tests" : "specs"}`,
      );
      if (!visualList) for (const item of bin.items) console.error(`  ${item}`);
    }
  }

  const summary = option("summary");
  if (summary) {
    const title = visualList
      ? `Visual capture deal (${count} shards)`
      : `Playwright deal (${count} shards)`;
    // Milliseconds once anything is recorded (the estimate is scaled onto
    // them); bare estimate units before the first refresh.
    const unit = recordedShare > 0 ? "ms" : "units";
    await appendFile(
      summary,
      `${summarizeBins(bins, { title, shard: index, unit, recordedShare })}\n`,
    );
  }

  // One item per line. Spec paths go into a bash array (a spec path must never
  // carry a space; nothing under `e2e/` does), and visual lines are written to
  // a file for `playwright test --test-list`.
  for (const item of bins[index - 1].items) console.log(item);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
