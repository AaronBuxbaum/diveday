import { describe, expect, it } from "vitest";
import { dueCheckoutRecovery, RECOVERY_DELAY_HOURS } from "./checkout-recovery";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-07-26T12:00:00Z");

function checkout(overrides: Partial<Parameters<typeof dueCheckoutRecovery>[0]> = {}) {
  return {
    status: "pending" as const,
    createdAt: new Date(NOW.getTime() - (RECOVERY_DELAY_HOURS + 1) * HOUR_MS),
    expiresAt: new Date(NOW.getTime() + HOUR_MS),
    customerEmail: "diver@example.com",
    abandonedRecoverySentAt: null,
    ...overrides,
  };
}

describe("dueCheckoutRecovery", () => {
  it("is due once the delay has passed, with an email and time left on the session", () => {
    expect(dueCheckoutRecovery(checkout(), NOW)).toBe(true);
  });

  it("is not due before the delay has elapsed", () => {
    const fresh = checkout({ createdAt: new Date(NOW.getTime() - 30 * 60 * 1000) });
    expect(dueCheckoutRecovery(fresh, NOW)).toBe(false);
  });

  it("is due exactly at the delay boundary", () => {
    const atBoundary = checkout({
      createdAt: new Date(NOW.getTime() - RECOVERY_DELAY_HOURS * HOUR_MS),
    });
    expect(dueCheckoutRecovery(atBoundary, NOW)).toBe(true);
  });

  it("never fires for a completed or expired checkout", () => {
    expect(dueCheckoutRecovery(checkout({ status: "completed" }), NOW)).toBe(false);
    expect(dueCheckoutRecovery(checkout({ status: "expired" }), NOW)).toBe(false);
  });

  it("never fires twice", () => {
    const alreadySent = checkout({ abandonedRecoverySentAt: new Date(NOW.getTime() - HOUR_MS) });
    expect(dueCheckoutRecovery(alreadySent, NOW)).toBe(false);
  });

  it("never fires once the Stripe session itself has expired — a dead link helps no one", () => {
    const dead = checkout({ expiresAt: new Date(NOW.getTime() - HOUR_MS) });
    expect(dueCheckoutRecovery(dead, NOW)).toBe(false);
  });

  it("fires with no expiry set at all (a session Stripe never bounded)", () => {
    expect(dueCheckoutRecovery(checkout({ expiresAt: null }), NOW)).toBe(true);
  });

  it("never fires with no recipient on file", () => {
    expect(dueCheckoutRecovery(checkout({ customerEmail: null }), NOW)).toBe(false);
  });
});
