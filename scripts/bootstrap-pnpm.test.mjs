import { describe, expect, it } from "vitest";
import { bootstrapPnpm } from "./bootstrap-pnpm.mjs";

describe("pnpm bootstrap", () => {
  it("retries a bounded subprocess timeout even when npm printed nothing", () => {
    let calls = 0;
    const result = bootstrapPnpm({
      version: "12.4.1",
      prefix: "/tmp/pnpm",
      log: () => {},
      sleep: () => {},
      run: () =>
        ++calls === 1
          ? { status: 124, error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" }
          : { status: 0 },
    });
    expect(result).toBe(true);
    expect(calls).toBe(2);
  });
  it("retries a registry connection reset with bounded backoff and keeps attempt evidence", () => {
    const responses = [
      { status: 1, stderr: "npm error code ECONNRESET\n" },
      { status: 0, stdout: "added 1 package\n" },
    ];
    const calls = [];
    const logs = [];
    const delays = [];
    expect(
      bootstrapPnpm({
        version: "12.4.1",
        prefix: "/tmp/pnpm",
        run: (...args) => {
          calls.push(args);
          return responses.shift();
        },
        log: (line) => logs.push(line),
        sleep: (ms) => delays.push(ms),
      }),
    ).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toContain("pnpm@12.4.1");
    expect(calls[0][1]).toContain("--fetch-retries=0");
    expect(logs.join("\n")).toContain("ECONNRESET");
    expect(delays).toEqual([1000]);
  });

  it("stops after three transient errors and never retries a non-network error", () => {
    let calls = 0;
    const fail = (stderr) => () => {
      calls += 1;
      return { status: 1, stderr };
    };
    const base = { version: "12.4.1", prefix: "/tmp/pnpm", log: () => {}, sleep: () => {} };
    expect(bootstrapPnpm({ ...base, run: fail("npm error code ETIMEDOUT") })).toBe(false);
    expect(calls).toBe(3);
    calls = 0;
    expect(bootstrapPnpm({ ...base, run: fail("npm error code EACCES") })).toBe(false);
    expect(calls).toBe(1);
  });
});
