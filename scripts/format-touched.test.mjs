import path from "node:path";

import { describe, expect, it } from "vitest";

import { isNotAboutTheCode, shouldFormat } from "./format-touched.mjs";

/**
 * The path in a `PostToolUse` payload is an input, not a fact, and this hook turns it into
 * an argument to a binary that writes the file back. So the only interesting question here
 * is which paths it declines: anything that resolves outside the repository, and anything
 * Biome would not parse.
 */

const root = path.resolve("/repo");

describe("which edits are worth a Biome pass", () => {
  it("takes the source files Biome parses, relative or absolute", () => {
    for (const file of ["src/lib/clock.ts", "src/app/page.tsx", "scripts/check-repo.mjs"]) {
      expect(shouldFormat(file, root), file).toBe(true);
    }
    expect(shouldFormat(path.join(root, "src/app/globals.css"), root)).toBe(true);
  });

  it("declines what Biome has nothing to say about", () => {
    for (const file of ["AGENTS.md", "docs/agents/repo-checks.md", "drizzle/0001_x.sql"]) {
      expect(shouldFormat(file, root), file).toBe(false);
    }
  });

  it("declines anything that resolves outside the repository", () => {
    for (const file of ["../elsewhere/thing.ts", "/etc/hosts", "src/../../escape.ts"]) {
      expect(shouldFormat(file, root), file).toBe(false);
    }
  });

  it("declines a vendored file, which is not ours to rewrite", () => {
    expect(shouldFormat("node_modules/some-package/index.ts", root)).toBe(false);
  });

  it("declines a payload with no usable path rather than guessing", () => {
    expect(shouldFormat(undefined, root)).toBe(false);
    expect(shouldFormat("", root)).toBe(false);
    expect(shouldFormat(42, root)).toBe(false);
  });
});

/**
 * Both of these were produced by Biome, live, while this hook was being written: a path
 * under a `!`-excluded root in `biome.json`, and a path the edit had already moved away.
 * Biome exits non-zero for each, and reporting either back as a lint finding would tell the
 * session its edit is broken when it is not — the fastest way to teach somebody to ignore
 * this hook.
 */
describe("what Biome says that is not about the code", () => {
  it("stays quiet about a path Biome declined to process", () => {
    expect(isNotAboutTheCode("Checked 0 files in 6ms.\nNo files were processed.")).toBe(true);
    expect(
      isNotAboutTheCode("src/x.ts internalError/io  INTERNAL\nNo such file or directory"),
    ).toBe(true);
  });

  it("still speaks up about a real diagnostic", () => {
    expect(
      isNotAboutTheCode(
        "src/x.ts:1:8 lint/correctness/noUnusedImports  FIXABLE\nThis import is unused.",
      ),
    ).toBe(false);
  });
});
