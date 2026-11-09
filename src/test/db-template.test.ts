// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  inputsFingerprint,
  TEMPLATE_INPUT_EXCLUDES,
  TEMPLATE_INPUT_FILES,
  TEMPLATE_INPUT_ROOTS,
} from "./db-template-inputs";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "diveday-template-"));
  vi.stubEnv("DIVEDAY_TEST_CACHE_DIR", directory);
  vi.resetModules();
});
afterEach(async () => {
  vi.doUnmock("./db-template-inputs");
  vi.doUnmock("./db-template-build");
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

it("fingerprints helper edits, lockfiles and every declared input", async () => {
  for (const root of TEMPLATE_INPUT_ROOTS)
    await mkdir(path.join(directory, root), { recursive: true });
  for (const file of TEMPLATE_INPUT_FILES) await writeFile(path.join(directory, file), "initial");
  await mkdir(path.join(directory, "src/lib"));
  const files = [
    ...TEMPLATE_INPUT_FILES,
    "src/lib/clock.ts",
    "src/lib/capabilities.ts",
    "config/env-registry.mjs",
    "drizzle/migration.sql",
  ];
  let previous = await inputsFingerprint(directory);
  for (const name of ["clock.test.ts", "clock.spec.ts", "clock.snap"]) {
    await writeFile(path.join(directory, "src/lib", name), "test assertion");
    expect(await inputsFingerprint(directory)).toBe(previous);
  }
  for (const file of files) {
    await writeFile(path.join(directory, file), "changed");
    const next = await inputsFingerprint(directory);
    expect(next).not.toBe(previous);
    previous = next;
  }
});

it("validates manifest identity and every snapshot's bytes", async () => {
  const { readManifest, readSnapshot, manifestFile } = await import("./db-template-read");
  const bytes = Buffer.from("snapshot bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entry = { file: `${sha256}.tar`, size: bytes.length, sha256 };
  const manifest = { fingerprint: "fixture", files: { lean: entry, history: entry, empty: entry } };
  await writeFile(manifestFile("fixture"), JSON.stringify(manifest));
  expect(await readManifest("fixture")).toEqual(manifest);
  expect(await readSnapshot(entry)).toBeNull();
  await writeFile(path.join(directory, entry.file), bytes);
  expect(await readSnapshot(entry)).toEqual(new Uint8Array(bytes));
  await writeFile(path.join(directory, entry.file), bytes.subarray(0, 3));
  expect(await readSnapshot(entry)).toBeNull();
  await writeFile(path.join(directory, entry.file), Buffer.alloc(bytes.length));
  expect(await readSnapshot(entry)).toBeNull();
  manifest.fingerprint = "another-checkout";
  await writeFile(manifestFile("fixture"), JSON.stringify(manifest));
  expect(await readManifest("fixture")).toBeNull();
});

it("publishes a complete generation only after all blobs exist", async () => {
  const buildSnapshot = vi.fn(async (variant: string) => Buffer.from(variant));
  vi.doMock("./db-template-build", () => ({ buildSnapshot }));
  vi.doMock("./db-template-inputs", () => ({ inputsFingerprint: async () => "generation" }));
  const { ensureTestDbTemplate } = await import("./db-template");
  const { readManifest, readSnapshot } = await import("./db-template-read");
  await Promise.all([ensureTestDbTemplate(), ensureTestDbTemplate()]);
  const manifest = await readManifest("generation");
  expect(manifest).not.toBeNull();
  for (const entry of Object.values(manifest?.files ?? {}))
    expect(await readSnapshot(entry)).not.toBeNull();
  buildSnapshot.mockClear();
  await ensureTestDbTemplate();
  expect(buildSnapshot).not.toHaveBeenCalled();
  const lean = manifest?.files.lean;
  if (!lean) throw new Error("missing lean");
  await rm(path.join(directory, lean.file));
  await ensureTestDbTemplate();
  expect(buildSnapshot).toHaveBeenCalledTimes(3);
  vi.doUnmock("./db-template-build");
  vi.doUnmock("./db-template-inputs");
});

it("outer immutable CI caches include the same input manifest", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const keys = workflow
    .split("\n")
    .filter((line) => line.includes("-pglite-template-") && line.includes("key:"));
  expect(keys).toHaveLength(2);
  expect(keys[0]?.trim()).toBe(keys[1]?.trim());
  for (const file of [
    ...TEMPLATE_INPUT_ROOTS.map((root) => `${root}/**`),
    ...TEMPLATE_INPUT_FILES,
    ...TEMPLATE_INPUT_EXCLUDES,
  ]) {
    for (const key of keys) expect(key).toContain(`'${file}'`);
  }
});

it("does not publish an interrupted generation", async () => {
  vi.doMock("./db-template-inputs", () => ({ inputsFingerprint: async () => "interrupted" }));
  vi.doMock("./db-template-build", () => ({
    buildSnapshot: async (variant: string) => {
      if (variant === "history") throw new Error("interrupted");
      return Buffer.from(variant);
    },
  }));
  const { ensureTestDbTemplate } = await import("./db-template");
  const { readManifest } = await import("./db-template-read");
  await expect(ensureTestDbTemplate()).rejects.toThrow("interrupted");
  expect(await readManifest("interrupted")).toBeNull();
  vi.doUnmock("./db-template-inputs");
  vi.doUnmock("./db-template-build");
});

it("memoizes by cache directory and content identity, not by variant", async () => {
  vi.doMock("./db-template-inputs", () => ({ inputsFingerprint: async () => "reader-fixture" }));
  const publish = async (root: string, value: string) => {
    const bytes = Buffer.from(value);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const entry = { file: `${sha256}.tar`, size: bytes.length, sha256 };
    await writeFile(path.join(root, entry.file), bytes);
    await writeFile(
      path.join(root, "reader-fixture.json"),
      JSON.stringify({
        fingerprint: "reader-fixture",
        files: { lean: entry, history: entry, empty: entry },
      }),
    );
  };
  await publish(directory, "first checkout");
  const first = await import("./db-template-read");
  expect(Buffer.from((await first.templateBytes()) ?? []).toString()).toBe("first checkout");
  const other = path.join(directory, "other");
  await mkdir(other);
  await publish(other, "second checkout");
  vi.stubEnv("DIVEDAY_TEST_CACHE_DIR", other);
  vi.resetModules();
  const second = await import("./db-template-read");
  expect(Buffer.from((await second.templateBytes()) ?? []).toString()).toBe("second checkout");
});
