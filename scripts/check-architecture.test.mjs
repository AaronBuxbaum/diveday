import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { auditBaseline, collectViolations } from "./check-architecture.mjs";

// ---------------------------------------------------------------------------
// Throwaway trees shaped like the repo, because the thing under test is
// precisely "what does the scanner see on disk". Each helper writes one file
// into a fresh tmpdir root and hands the root to `collectViolations`.

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "check-architecture-"));
  for (const [relative, contents] of Object.entries(files)) {
    await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    await writeFile(path.join(root, relative), contents);
  }
  return root;
}

const flat = (violations) => [...violations.values()].flat();

describe("dependency direction", () => {
  it("catches a bare side-effect import — the ARCH-2 blind spot", async () => {
    // `import "@/app/x"` binds no name, so the original `from|import(|require(`
    // pattern never saw it. This is the regression probe for that fix.
    const root = await fixture({
      "src/lib/boot.ts": 'import "@/app/globals-side-effect";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([
      "src/lib/boot.ts: imports @/app/globals-side-effect",
    ]);
  });

  it("still catches the named, dynamic, and re-export forms", async () => {
    const root = await fixture({
      "src/lib/a.ts": 'import { x } from "@/features/calendar-sync";\n',
      "src/db/b.ts": 'const m = await import("@/app/actions/demo");\n',
      "src/db/c.ts": 'export * from "../app/page";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      "src/db/b.ts: imports @/app/actions/demo",
      "src/db/c.ts: imports ../app/page",
      "src/lib/a.ts: imports @/features/calendar-sync",
    ]);
  });

  it("holds src/components and src/i18n to the direction too", async () => {
    const root = await fixture({
      "src/components/Nav.tsx": 'import { act } from "@/app/actions/demo";\n',
      "src/i18n/labels.ts": 'import { Button } from "@/components/ui/button";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      "src/components/Nav.tsx: imports @/app/actions/demo",
      "src/i18n/labels.ts: imports @/components/ui/button",
    ]);
  });

  it("lets the allowed directions through", async () => {
    const root = await fixture({
      "src/components/Card.tsx": 'import { fmt } from "@/lib/format";\nimport t from "@/i18n/x";\n',
      "src/i18n/negotiate.ts": 'import { getDb } from "@/lib/clock";\n',
      "src/lib/format.ts": 'import path from "node:path";\nimport "./polyfill";\n',
    });
    expect(flat(await collectViolations(root))).toEqual([]);
  });
});

describe("feature-module contract", () => {
  it("flags a deep import even in side-effect form", async () => {
    const root = await fixture({
      "src/features/calendar-sync/index.ts": "export {};\n",
      "src/features/calendar-sync/README.md": "# calendar-sync\n",
      "src/features/calendar-sync/internal.ts": "export const x = 1;\n",
      // Split so the real scanner (which walks scripts/ too) doesn't read this
      // fixture string as a deep import of its own.
      "src/app/page.tsx": `import "${"@/features"}/calendar-sync/internal";\n`,
    });
    expect(flat(await collectViolations(root))).toEqual([
      'src/app/page.tsx: deep-imports @/features/calendar-sync/internal — import from "@/features/calendar-sync" instead',
    ]);
  });

  it("keys missing index/README on the module directory", async () => {
    const root = await fixture({
      "src/features/bare/thing.ts": "export const x = 1;\n",
    });
    const violations = await collectViolations(root);
    expect([...violations.keys()]).toEqual(["src/features/bare"]);
    expect(violations.get("src/features/bare")).toHaveLength(2);
  });
});

describe("the ratchet", () => {
  const violations = new Map([
    ["src/components/A.tsx", ["src/components/A.tsx: imports @/app/x"]],
    [
      "src/components/B.tsx",
      ["src/components/B.tsx: imports @/app/x", "src/components/B.tsx: imports @/app/y"],
    ],
  ]);

  it("is silent when the baseline matches reality", () => {
    expect(
      auditBaseline(violations, { "src/components/A.tsx": 1, "src/components/B.tsx": 2 }),
    ).toEqual([]);
  });

  it("fails a file with no baseline entry, listing the imports", () => {
    const failures = auditBaseline(violations, { "src/components/B.tsx": 2 });
    expect(failures).toEqual(["src/components/A.tsx: imports @/app/x"]);
  });

  it("fails a count that rose", () => {
    const failures = auditBaseline(violations, {
      "src/components/A.tsx": 1,
      "src/components/B.tsx": 1,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("baseline allows 1");
  });

  it("fails an unbanked reduction and a stale entry, so the baseline tracks reality", () => {
    const failures = auditBaseline(violations, {
      "src/components/A.tsx": 1,
      "src/components/B.tsx": 3,
      "src/components/Gone.tsx": 1,
    });
    expect(failures.some((f) => f.includes("down to 2 from 3"))).toBe(true);
    expect(failures.some((f) => f.includes("Gone.tsx: clean or gone"))).toBe(true);
  });
});
