import { describe, expect, it } from "vitest";
import { envReadsIn, isAccounted } from "./check-env-reads.mjs";

describe("env reads", () => {
  it("finds every shape a key is read in", () => {
    const reads = envReadsIn(`
      const a = process.env.RECAP_LINK_SECRET;
      const b = process.env["BUDDY_LINK_SECRET"];
      function c(env = process.env) { return env.STRIPE_SECRET_KEY; }
      const d = process.env.lowercase;
    `);
    expect([...reads.keys()]).toEqual([
      "RECAP_LINK_SECRET",
      "BUDDY_LINK_SECRET",
      "STRIPE_SECRET_KEY",
    ]);
    expect(reads.get("BUDDY_LINK_SECRET")).toBe(3);
  });

  it("accounts for a registered key, a named platform key and a cron monitor slug", () => {
    expect(isAccounted("RECAP_LINK_SECRET", ["RECAP_LINK_SECRET"])).toBe(true);
    expect(isAccounted("NODE_ENV", [])).toBe(true);
    expect(isAccounted("SENTRY_RETENTION_CRON_MONITOR_SLUG", [])).toBe(true);
  });

  it("refuses a key nobody registered", () => {
    expect(isAccounted("NEW_SIGNING_SECRET", ["RECAP_LINK_SECRET"])).toBe(false);
  });
});
