import path from "node:path";
import { describe, expect, it } from "vitest";
import { floorFiles, readFloors } from "./floors.mjs";
import { classifyScope, scopeFiles } from "./scope.mjs";
import {
  buildTestIndex,
  HUB_TEST_LIMIT,
  resolveSpecifier,
  runtimeSpecifiers,
} from "./select-tests.mjs";

const ROOT = path.join(import.meta.dirname, "..", "..");

describe("classifyScope", () => {
  it("names money files", () => {
    for (const file of [
      "src/lib/payments/settlement.ts",
      "src/lib/billing/standing.ts",
      "src/features/money/owed.ts",
      "src/db/refunds.ts",
      "src/db/trip-credit-ledger.ts",
      "src/lib/pass-through-fee.ts",
      "src/lib/promo-codes.ts",
      "src/features/money/trip-credit/store.ts",
    ])
      expect(classifyScope(file), file).toBe("money");
  });
  it("names safety files from the coverage list", () => {
    for (const file of ["src/lib/readiness.ts", "src/lib/trip-admission.ts", "src/lib/authz.ts"])
      expect(classifyScope(file), file).toBe("safety");
  });
  it("leaves tests, seed data, other areas and look-alike names alone", () => {
    for (const file of [
      "src/lib/readiness.test.ts",
      "src/db/seed/payments.ts",
      "src/lib/recurrence.ts",
      "src/features/crew-and-boats/calendar-sync/feed-store.ts",
      "src/app/shop/[shopSlug]/orders/[id]/refund-activity.ts",
      "src/test/shop-facts/seed-failed-refund.ts",
      "scripts/mutation/fixtures/pinned/adult.ts",
    ])
      expect(classifyScope(file), file).toBeNull();
  });
  it("filters a changed-path list", () => {
    expect(scopeFiles(["docs/x.md", "src/lib/readiness.ts", "src/lib/money.ts"])).toEqual([
      "src/lib/money.ts",
      "src/lib/readiness.ts",
    ]);
  });
});

describe("test selection", () => {
  it("reads runtime specifiers and ignores type-only imports", () => {
    const source =
      'import type { A } from "@/lib/a";\nimport { b } from "@/lib/b";\nimport "./c";\nconst d = await import("../d");\nexport { e } from "./e";\n';
    expect(runtimeSpecifiers(source)).toEqual(["@/lib/b", "./c", "../d", "./e"]);
  });
  it("resolves the alias and relative paths with or without an extension", () => {
    expect(resolveSpecifier(ROOT, "src/lib/x.test.ts", "@/lib/readiness")).toBe(
      "src/lib/readiness.ts",
    );
    expect(resolveSpecifier(ROOT, "src/lib/x.test.ts", "./readiness.ts")).toBe(
      "src/lib/readiness.ts",
    );
    expect(resolveSpecifier(ROOT, "src/lib/x.test.ts", "vitest")).toBeNull();
  });
  it("selects importers and colocated siblings, never postgres or guard files", () => {
    const select = buildTestIndex(ROOT);
    const { files } = select("src/lib/trip-admission.ts");
    expect(files).toContain("src/lib/trip-admission.test.ts");
    expect(files).toContain("src/lib/trip-admission-gate.test.ts");
    expect(files.some((file) => file.includes(".postgres.test."))).toBe(false);
    expect(select("scripts/mutation/fixtures/pinned/adult.ts").files).toEqual([
      "scripts/mutation/fixtures/pinned/adult.test.ts",
    ]);
  });
  // src/db/bookings.ts is named by more test files than a run can finish: its baseline outran
  // five minutes on CI (#4904), so it is drilled against the tests named after it.
  it("drills a hub against the tests named after it, and leaves an ordinary module alone", () => {
    const select = buildTestIndex(ROOT);
    const narrowed = select("src/db/bookings.ts");
    const hub = narrowed.files;
    expect(narrowed.narrowedFrom).toBeGreaterThan(HUB_TEST_LIMIT);
    expect(select("src/lib/trip-admission.ts").narrowedFrom).toBeUndefined();
    expect(hub.length).toBeGreaterThan(0);
    expect(hub.length).toBeLessThanOrEqual(HUB_TEST_LIMIT);
    expect(hub).toContain("src/db/bookings.test.ts");
    expect(hub).toContain("src/db/bookings-capacity.test.ts");
    expect(hub.every((file) => /^src\/db\/bookings[.-]/.test(file))).toBe(true);
    // Under the limit nothing is narrowed: an importer in another folder still runs.
    const ordinary = select("src/lib/trip-admission.ts").files;
    expect(ordinary.length).toBeLessThanOrEqual(HUB_TEST_LIMIT);
    expect(ordinary.some((file) => !file.startsWith("src/lib/trip-admission"))).toBe(true);
  });
});

describe("floors.json", () => {
  it("names only files in scope", () => {
    for (const file of floorFiles(readFloors(ROOT)))
      expect(classifyScope(file), file).not.toBeNull();
  });
});
