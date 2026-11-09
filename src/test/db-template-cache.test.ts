import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const filesystem = vi.hoisted(() => ({
  readFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}));
const builder = vi.hoisted(() => ({
  loaded: vi.fn(),
  buildSnapshot: vi.fn(async (variant: string) => Buffer.from(variant)),
}));
const inputs = vi.hoisted(() => ({ inputsFingerprint: vi.fn(async () => "current") }));
vi.mock("node:fs/promises", () => filesystem);
vi.mock("./db-template-inputs", () => inputs);
vi.mock("./db-template-build", () => {
  builder.loaded();
  return { buildSnapshot: builder.buildSnapshot };
});
vi.mock("@/db/seed", () => {
  throw new Error("snapshot cache hit imported seed graph");
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  inputs.inputsFingerprint.mockResolvedValue("current");
  const bytes = Buffer.from("snapshot");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entry = { file: `${sha256}.tar`, size: bytes.length, sha256 };
  filesystem.readFile.mockImplementation(async (file: string) =>
    file.endsWith(".tar")
      ? bytes
      : JSON.stringify({
          fingerprint: "current",
          files: { lean: entry, history: entry, empty: entry },
        }),
  );
});

it("reuses validated snapshots without loading the builder or seed graph", async () => {
  const { ensureTestDbTemplate } = await import("./db-template");
  await ensureTestDbTemplate();
  expect(builder.loaded).not.toHaveBeenCalled();
  expect(filesystem.writeFile).not.toHaveBeenCalled();
});

it("publishes one complete manifest after all immutable blobs", async () => {
  inputs.inputsFingerprint.mockResolvedValue("changed");
  const { ensureTestDbTemplate } = await import("./db-template");
  await ensureTestDbTemplate();
  expect(builder.buildSnapshot.mock.calls.map(([variant]) => variant)).toEqual([
    "lean",
    "history",
    "empty",
  ]);
  expect(filesystem.rename).toHaveBeenCalledTimes(4);
  const manifest = JSON.parse(filesystem.writeFile.mock.calls.at(-1)?.[1]);
  expect(manifest.fingerprint).toBe("changed");
  expect(Object.keys(manifest.files)).toEqual(["lean", "history", "empty"]);
  expect(filesystem.rename.mock.calls.at(-1)?.[1]).toMatch(/changed\.json$/);
  for (const [staging, destination] of filesystem.rename.mock.calls) {
    expect(staging).toMatch(/\.tmp$/);
    expect(staging.startsWith(destination)).toBe(true);
  }
});

it("reports observed fingerprint and cache timing only when requested", async () => {
  const { ensureTestDbTemplate } = await import("./db-template");
  const observations: { phase: string; durationMs: number; cacheHit?: boolean }[] = [];
  await ensureTestDbTemplate({ onTiming: (timing) => observations.push(timing) });
  expect(observations.map((row) => row.phase)).toEqual(["fingerprint", "cache"]);
  expect(observations[1]?.cacheHit).toBe(true);
  expect(observations.every((row) => Number.isFinite(row.durationMs) && row.durationMs >= 0)).toBe(
    true,
  );
});
