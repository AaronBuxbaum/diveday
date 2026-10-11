import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { auditBaseline, collectViolations, importsOf } from "./check-architecture.mjs";

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

describe("the seams", () => {
  it("reads which imports are type-only, across lines", () => {
    const source = [
      'import type { A } from "@/db/a";',
      'import { type B, type C } from "@/db/b";',
      'import { type D, e } from "@/db/d";',
      "import {\n  type F,\n  g,\n} from '@/db/f';",
      'export type { H } from "@/db/h";',
      'export { i } from "@/db/i";',
      'import "@/db/side-effect";',
      'const j = await import("@/db/j");',
    ].join("\n");
    expect(importsOf(source)).toEqual([
      { specifier: "@/db/a", typeOnly: true },
      { specifier: "@/db/b", typeOnly: true },
      { specifier: "@/db/d", typeOnly: false },
      { specifier: "@/db/f", typeOnly: false },
      { specifier: "@/db/h", typeOnly: true },
      { specifier: "@/db/i", typeOnly: false },
      { specifier: "@/db/side-effect", typeOnly: false },
      { specifier: "@/db/j", typeOnly: false },
    ]);
  });

  it("lets src/lib name a db type and refuses a db value", async () => {
    const root = await fixture({
      "src/lib/shape.ts": 'import type { AppDb } from "@/db/client";\n',
      "src/lib/loader.ts": 'import { getDb } from "@/db/client";\n',
      "src/lib/lazy.ts": 'const m = await import("../db/recap");\n',
      "src/lib/loader.test.ts": 'import { createTestDb } from "@/db/client";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/lib/lazy.ts: value-imports ../db/recap"),
      expect.stringContaining("src/lib/loader.ts: value-imports @/db/client"),
    ]);
  });

  it("refuses drizzle-orm under src/app, outside its tests and e2e fixture routes", async () => {
    const root = await fixture({
      "src/app/shop/actions.ts": 'import { eq } from "drizzle-orm";\n',
      "src/app/shop/types.ts": 'import type { SQL } from "drizzle-orm/sql";\n',
      "src/app/shop/actions.test.ts": 'import { eq } from "drizzle-orm";\n',
      "src/app/api/test/seed/route.ts": 'import { eq } from "drizzle-orm";\n',
      "src/db/reads.ts": 'import { eq } from "drizzle-orm";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/app/shop/actions.ts: imports drizzle-orm"),
      expect.stringContaining("src/app/shop/types.ts: imports drizzle-orm/sql"),
    ]);
  });

  it("sends everything outside src/db through the trips barrel", async () => {
    const root = await fixture({
      "src/app/trip/page.tsx": 'import { getTripOverview } from "@/db/trips-overview";\n',
      "src/components/Roster.tsx": 'import type { TripGuests } from "@/db/trips-guests";\n',
      "src/app/trip/ok.tsx": 'import { getTripOverview } from "@/db/trips";\n',
      "src/db/today.ts": 'import { listStaff } from "./trips-crew";\n',
      "src/app/trip/other.tsx": 'import { x } from "@/db/trip-promos";\n',
    });
    expect(flat(await collectViolations(root)).sort()).toEqual([
      expect.stringContaining("src/app/trip/page.tsx: imports @/db/trips-overview"),
      expect.stringContaining("src/components/Roster.tsx: imports @/db/trips-guests"),
    ]);
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
