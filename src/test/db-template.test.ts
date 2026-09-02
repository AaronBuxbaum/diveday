// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The snapshot cache, from the reader's side.
 *
 * Investigated for #1157, whose reported symptom — PGlite fixtures reading the
 * local-day state blowing past Vitest's 20-second ceiling — did **not**
 * reproduce here (full `pnpm check` green, 8,485 tests, no timeout). What the
 * investigation did turn up is the mechanism that would produce it: the
 * fallback in `seededTestDb` costs `initdb + migrate + seed`, about 8.5s per
 * test against a hydration's ~0.7s, and both of the ways into it were silent.
 *
 * These pin the reader's half. `templateBytes` is re-imported per test because
 * it memoizes on `globalThis` and caches the *rejected* read too.
 */

const CACHE_ENV = "DIVEDAY_TEST_CACHE_DIR";

let cacheDir: string;
let previousCacheDir: string | undefined;

/**
 * A fresh module instance. Two caches have to be cleared, not one:
 * `CACHE_DIR` is resolved at module scope from `DIVEDAY_TEST_CACHE_DIR`, so the
 * module must be re-evaluated after the env var moves; and `templateBytes`
 * memoizes on `globalThis`, which survives that — including a *rejected* read,
 * which is exactly the value under test.
 */
async function freshTemplateBytes() {
  const globalForTemplate = globalThis as { divedayTestDbTemplate?: unknown };
  globalForTemplate.divedayTestDbTemplate = undefined;
  vi.resetModules();
  const module = await import("./db-template");
  return module.templateBytes;
}

beforeEach(async () => {
  previousCacheDir = process.env[CACHE_ENV];
  cacheDir = await mkdtemp(path.join(tmpdir(), "diveday-template-"));
  process.env[CACHE_ENV] = cacheDir;
});

afterEach(async () => {
  if (previousCacheDir === undefined) delete process.env[CACHE_ENV];
  else process.env[CACHE_ENV] = previousCacheDir;
  await rm(cacheDir, { recursive: true, force: true });
});

describe("templateBytes", () => {
  it("reads a snapshot that is there", async () => {
    await writeFile(path.join(cacheDir, "test-db-template.tar"), Buffer.from("not-really-a-tar"));
    const templateBytes = await freshTemplateBytes();
    const bytes = await templateBytes("lean");
    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes as Uint8Array).toString()).toBe("not-really-a-tar");
  });

  it("answers null when there is no snapshot, so the caller can seed from scratch", async () => {
    const templateBytes = await freshTemplateBytes();
    expect(await templateBytes("lean")).toBeNull();
  });

  /**
   * The one that was a bug. `writeFile` truncates before it streams ~70MB, so a
   * parallel Vitest invocation rewriting the snapshot leaves it zero-length for
   * that whole window — and an empty `Uint8Array` is **truthy**, so it sailed
   * past `seededTestDb`'s `if (!bytes)` guard and reached PGlite as an empty
   * tar. Measured: that throws `Error: PGlite failed to initialize properly`,
   * which names neither the cause nor the fix.
   */
  it("answers null for a zero-length snapshot rather than handing PGlite an empty tar", async () => {
    await writeFile(path.join(cacheDir, "test-db-template.tar"), Buffer.alloc(0));
    const templateBytes = await freshTemplateBytes();
    expect(await templateBytes("lean")).toBeNull();
  });

  it("keeps the two variants apart", async () => {
    await writeFile(path.join(cacheDir, "test-db-template-history.tar"), Buffer.from("history"));
    const templateBytes = await freshTemplateBytes();
    expect(await templateBytes("lean")).toBeNull();
    expect(Buffer.from((await templateBytes("history")) as Uint8Array).toString()).toBe("history");
  });
});

describe("the snapshot is published atomically", () => {
  /**
   * `ensureTestDbTemplate` builds two 70MB snapshots, which is far too slow to
   * run here. What this holds is the property that makes the window safe: the
   * live path is only ever created by a rename, so a reader sees the whole old
   * snapshot or the whole new one and never a prefix of either.
   *
   * AGENTS.md's *Parallel work* says to expect concurrent sessions in one
   * working directory, and `DIVEDAY_TEST_CACHE_DIR` exists because worktrees
   * can share a single `node_modules` volume — so this window is a real one,
   * not a theoretical race.
   */
  it("writes through a sibling temp file and renames onto the live path", async () => {
    const source = await readFile(path.join(process.cwd(), "src/test/db-template.ts"), "utf8");
    expect(source).toContain("await rename(staging, destination);");
    // The staging path must be a sibling, or `rename` crosses a filesystem and
    // stops being atomic — and must be per-process, or two parallel builders
    // clobber each other's temp file instead of the live one.
    expect(source).toMatch(/const staging = `\$\{destination\}\.\$\{process\.pid\}\.tmp`;/);
    // Never a direct write to the live path.
    expect(source).not.toMatch(/writeFile\(\s*templateFile\(/);
  });
});
