import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: these are Server Components behind the session gate and a
 * dozen server actions. **Every seats-left a staffer reads is measured against
 * the seats on sale** (H-20261009-certificate-caps-seats, #2321) — the stated capacity capped at the boat's
 * certificate, which is all the booking transaction will sell. A departure
 * stating 14 on a hull certified for 12 offered "Add diver" at 12 aboard and
 * then refused the seat. The details form still edits the stated number; that
 * one is not here.
 */
const SURFACES = ["page.tsx", join("_components", "TripRosterContent.tsx")] as const;

describe("staff seats-left on a departure", () => {
  for (const file of SURFACES) {
    it(`${file} never counts open seats against the stated capacity`, () => {
      const source = readFileSync(join(import.meta.dirname, file), "utf8");
      expect(source).not.toMatch(/isFull\(trip\)/);
      expect(source).not.toMatch(/spotsRemaining\(\{\s*capacity:\s*trip\.capacity/);
      expect(source).not.toMatch(/capacity:\s*trip\.capacity\b/);
    });
  }
});
