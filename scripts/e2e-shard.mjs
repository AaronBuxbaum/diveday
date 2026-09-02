#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
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
 * ## Why a static estimate
 *
 * It reads the source and never runs it, so every shard computes the identical
 * partition from the same tree. That is the property that matters more than
 * accuracy: a deal that disagreed between shards would run a spec twice, or
 * not at all, and the second failure is silent. Nothing is recorded between
 * runs and nothing is fetched — the same tree always deals the same way.
 *
 * The weights only have to be right *relative to each other*.
 */

const SPEC_ROOT = "e2e";

/**
 * Captured by the visual pipeline, never by this job — `visual.spec.ts` has its
 * own four shards and its own baseline plumbing.
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

/** The full deal: `count` bins of spec paths, computed from the tree at `root`. */
export async function dealSpecs(count, root = process.cwd()) {
  const specs = await listSpecs(root);
  const weighted = await Promise.all(
    specs.map(async (spec) => ({
      item: spec,
      weight: estimateCost(await readSource(path.join(root, spec))),
    })),
  );
  return partition(weighted, count);
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
  const shardArg = args.find((arg) => arg.startsWith("--shard="));
  if (!shardArg) {
    console.error("usage: node scripts/e2e-shard.mjs --shard=<index>/<count> [--explain]");
    process.exit(2);
  }
  const [index, count] = shardArg.slice("--shard=".length).split("/").map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) {
    console.error(`e2e-shard: --shard must be <index>/<count> with 1 <= index <= count`);
    process.exit(2);
  }

  const bins = await dealSpecs(count);

  if (args.includes("--explain")) {
    // The whole deal, for reading a slow run afterwards. Stderr, so `--explain`
    // can be added to the workflow command without the listing reaching
    // Playwright's argument list.
    for (const [i, bin] of bins.entries()) {
      console.error(`shard ${i + 1}/${count}  weight ${bin.load}  ${bin.items.length} specs`);
      for (const item of bin.items) console.error(`  ${item}`);
    }
  }

  // One path per line: the workflow reads it into a bash array, so a spec path
  // must never carry a space. Nothing under `e2e/` does, and Playwright would
  // be the second thing to break if one did.
  for (const spec of bins[index - 1].items) console.log(spec);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
