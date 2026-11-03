import { describe, expect, it } from "vitest";
import { harnessReadLine } from "./check-harness-env.mjs";

describe("harness env reads", () => {
  it("finds a direct read of either harness variable", () => {
    expect(harnessReadLine('a;\nif (process.env.DIVEDAY_E2E === "1") x();')).toBe(2);
    expect(harnessReadLine("const c = env.DIVEDAY_CLOCK;")).toBe(1);
  });

  it("ignores comments, the secret and unrelated variables", () => {
    expect(harnessReadLine(" * reads process.env.DIVEDAY_E2E in a comment")).toBeNull();
    expect(harnessReadLine("process.env.DIVEDAY_E2E_SECRET")).toBeNull();
    expect(harnessReadLine("process.env.NODE_ENV")).toBeNull();
  });
});
