import { afterEach, describe, expect, it, vi } from "vitest";
import { makeZodJitless } from "./zod-jitless";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete (globalThis as { __zod_globalConfig?: unknown }).__zod_globalConfig;
});

describe("makeZodJitless", () => {
  it("set before Zod loads, Zod parses an object without new Function", async () => {
    makeZodJitless();
    const compile = vi.spyOn(globalThis, "Function");
    const { z } = await import("zod");
    const { config } = await import("zod/v4/core");
    expect(config().jitless).toBe(true);
    expect(z.object({ name: z.string() }).parse({ name: "Ana" })).toEqual({ name: "Ana" });
    expect(compile).not.toHaveBeenCalled();
  });

  it("set after Zod loads, reaches the config Zod already holds", async () => {
    const { config } = await import("zod/v4/core");
    makeZodJitless();
    expect(config().jitless).toBe(true);
  });
});
