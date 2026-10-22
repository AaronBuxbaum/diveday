import { beforeEach, expect, it, vi } from "vitest";

const filesystem = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(async () => []),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
}));
const builder = vi.hoisted(() => ({
  loaded: vi.fn(),
  buildSnapshot: vi.fn(async (variant: string) => Buffer.from(variant)),
}));

vi.mock("node:fs/promises", () => filesystem);
vi.mock("./db-template-build", () => {
  builder.loaded();
  return { buildSnapshot: builder.buildSnapshot };
});
vi.mock("@/db/seed", () => {
  throw new Error("snapshot cache hit imported the seed graph");
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  filesystem.readFile.mockImplementation(async (file: string) => {
    if (file.endsWith("frozen-clock.ts")) return "frozen clock";
    if (file.endsWith("db-template-build.ts")) return "builder";
    return JSON.stringify({
      fingerprint: "eb90656c219b8c9c713693a568c7818d6c3acbe6e3fb4575fa883e80b3df52aa",
      variants: ["lean", "history", "empty"],
    });
  });
});

it("reuses a current snapshot without loading the database builder or seed graph", async () => {
  const { ensureTestDbTemplate } = await import("./db-template");
  await ensureTestDbTemplate();
  expect(builder.loaded).not.toHaveBeenCalled();
  expect(filesystem.writeFile).not.toHaveBeenCalled();
});

it("rebuilds and atomically publishes every variant when the builder changes", async () => {
  filesystem.readFile.mockImplementation(async (file: string) => {
    if (file.endsWith("frozen-clock.ts")) return "frozen clock";
    if (file.endsWith("db-template-build.ts")) return "builder changed";
    return JSON.stringify({
      fingerprint: "eb90656c219b8c9c713693a568c7818d6c3acbe6e3fb4575fa883e80b3df52aa",
      variants: ["lean", "history", "empty"],
    });
  });
  const { ensureTestDbTemplate } = await import("./db-template");
  const { templateFile } = await import("./db-template-read");
  await ensureTestDbTemplate();
  expect(builder.loaded).toHaveBeenCalledOnce();
  expect(builder.buildSnapshot.mock.calls.map(([variant]) => variant)).toEqual([
    "lean",
    "history",
    "empty",
  ]);
  for (const variant of ["lean", "history", "empty"] as const) {
    const destination = templateFile(variant);
    expect(filesystem.writeFile).toHaveBeenCalledWith(
      `${destination}.${process.pid}.tmp`,
      Buffer.from(variant),
    );
    expect(filesystem.rename).toHaveBeenCalledWith(
      `${destination}.${process.pid}.tmp`,
      destination,
    );
  }
  expect(JSON.parse(filesystem.writeFile.mock.calls.at(-1)?.[1])).toMatchObject({
    variants: ["lean", "history", "empty"],
  });
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
  expect(filesystem.writeFile).not.toHaveBeenCalled();
});
