import { describe, expect, it } from "vitest";

import { runGuard } from "./guard-fixture.mjs";

// Every root the guard walks has to exist, so a fixture carries all three.
const tree = (files) => ({ "src/": "", "scripts/": "", "e2e/": "", ...files });

describe("check-source-text", () => {
  it("passes UTF-8 source, multi-byte characters included", () => {
    const result = runGuard(
      "check-source-text.mjs",
      tree({ "src/a.ts": 'export const dash = "—";\n', "e2e/b.spec.ts": "// ok\n" }),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("source files are valid UTF-8 without NUL bytes");
  });

  it("refuses a NUL byte", () => {
    const result = runGuard(
      "check-source-text.mjs",
      tree({ "scripts/a.mjs": Buffer.from("const a = 1;\0\n") }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("scripts/a.mjs: contains a NUL byte");
  });

  it("refuses bytes that are not UTF-8 — a Latin-1 save of an accented string", () => {
    const result = runGuard(
      "check-source-text.mjs",
      tree({ "src/b.tsx": Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]) }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/b.tsx: is not valid UTF-8");
  });

  it("leaves files that are not source alone", () => {
    const result = runGuard(
      "check-source-text.mjs",
      tree({ "src/photo.png": Buffer.from([0x89, 0x50, 0x00, 0xff]) }),
    );
    expect(result.status).toBe(0);
  });
});
