import { describe, expect, it } from "vitest";
import * as gear from "./gear";

/**
 * `gear.ts` is a barrel, so the register's behaviour is pinned beside the
 * module that owns it: `gear-items.test.ts`, `gear-service.test.ts`,
 * `gear-service-due.test.ts`, `gear-reservations.test.ts`,
 * `gear-availability.test.ts`, `gear-returns.test.ts`, `gear-register.test.ts`
 * and `gear-shared.test.ts`, over the helpers in `gear-test-fixtures.ts`. This
 * file pins only the barrel: every name it publishes is there to import.
 */
describe("the gear barrel", () => {
  it("publishes a defined value for every name it re-exports", () => {
    const missing = Object.entries(gear)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);
    expect(missing).toEqual([]);
    expect(Object.keys(gear)).toHaveLength(35);
  });
});
