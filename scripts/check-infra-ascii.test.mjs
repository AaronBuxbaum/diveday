import { describe, expect, it } from "vitest";

import { runGuard } from "./guard-fixture.mjs";

// The guard reads three named files beside the infra tree; each must exist.
const tree = (files) => ({
  "config/env-registry.mjs": "export const registry = [];\n",
  "scripts/render-env-example.mjs": "// renders .env.example\n",
  ".env.example": "DATABASE_URL=\n",
  "infra/lib/stack.ts": "export const a = 1;\n",
  ...files,
});

describe("check-infra-ascii", () => {
  it("passes plain ASCII, tabs included", () => {
    const result = runGuard(
      "check-infra-ascii.mjs",
      tree({ "infra/bin/app.ts": "\tconst b = 2;\n" }),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("infra-ascii: 5 deployed-text files are plain ASCII");
  });

  it("refuses an em dash in the stack, naming the line and the code point", () => {
    const result = runGuard(
      "check-infra-ascii.mjs",
      tree({ "infra/lib/stack.ts": "// fine\n// one — two\n" }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('infra/lib/stack.ts:2: non-ASCII character "—" (U+2014)');
    expect(result.stderr).toContain('an em dash becomes " -- "');
  });

  it("refuses one in the env registry, which is deployed into a secret", () => {
    const result = runGuard(
      "check-infra-ascii.mjs",
      tree({ "config/env-registry.mjs": 'export const why = "≤ 5";\n' }),
    );
    expect(result.stderr).toContain("config/env-registry.mjs:1: non-ASCII character");
  });

  it("leaves node_modules and cdk.out, and files of other kinds, alone", () => {
    const result = runGuard(
      "check-infra-ascii.mjs",
      tree({
        "infra/node_modules/x/index.js": "// —\n",
        "infra/cdk.out/x.js": "// —\n",
        "infra/README.md": "One — two\n",
      }),
    );
    expect(result.status).toBe(0);
  });
});
