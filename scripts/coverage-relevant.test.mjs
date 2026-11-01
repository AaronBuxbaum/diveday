import { describe, expect, it } from "vitest";
import { coverageRelevant } from "./coverage-relevant.mjs";

describe("coverageRelevant", () => {
  it.each([
    "src/lib/readiness.ts",
    "src/lib/readiness.test.ts",
    "src/lib/readiness.adversarial.test.ts",
    "src/db/bookings.ts",
    "src/db/bookings-capacity.test.ts",
    "vitest.config.ts",
    "src/test/db.ts",
    "scripts/coverage-floors.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
  ])("keeps coverage for %s", (file) => {
    expect(coverageRelevant(file)).toBe(true);
  });

  it.each([
    "src/app/s/page.tsx",
    "src/lib/clock.ts",
    "src/db/shops.ts",
    "src/lib/readiness-copy/x.ts",
    "e2e/booking.spec.ts",
    "docs/agents/working-rules.md",
    "src/i18n/locales/es-ES/diver.json",
  ])("skips coverage for %s", (file) => {
    expect(coverageRelevant(file)).toBe(false);
  });
});
