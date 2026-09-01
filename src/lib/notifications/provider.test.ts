import { describe, expect, it } from "vitest";
import type { Notification } from "./kinds";
import { disabledNotificationProvider, reservedTestRecipientDelivery } from "./provider";

/**
 * The guard at the provider boundary: every mail path — direct sends, deferred
 * account invites, batch sends — refuses a reserved test recipient the same way,
 * so a seeded person or a demo credential can never reach a real inbox or burn
 * an SES bounce.
 */
describe("reservedTestRecipientDelivery", () => {
  it("lets a real address through", () => {
    expect(reservedTestRecipientDelivery("marisol@bluemantis.dive")).toBeNull();
    expect(reservedTestRecipientDelivery("success@simulator.amazonses.com")).toBeNull();
  });

  it("refuses the RFC 2606 reserved domains as a non-retryable failure", () => {
    for (const to of [
      "diver@example.com",
      "diver@example.org",
      "diver@example.net",
      "diver@test.com",
      "diver@example",
      "diver@invalid",
      "diver@localhost",
      "diver@test",
    ]) {
      expect(reservedTestRecipientDelivery(to)).toMatchObject({
        status: "failed",
        retryable: false,
        errorCode: "invalid_test_recipient",
      });
    }
  });

  it("refuses the demo credentials domain, which is deliberately undeliverable", () => {
    expect(reservedTestRecipientDelivery("owner@demo.com")?.status).toBe("failed");
  });

  it("refuses subdomains of a reserved domain", () => {
    expect(reservedTestRecipientDelivery("diver@mail.example.com")?.status).toBe("failed");
    expect(reservedTestRecipientDelivery("diver@shop.test")?.status).toBe("failed");
  });

  it("is not fooled by case or a trailing dot on the domain", () => {
    expect(reservedTestRecipientDelivery("Diver@EXAMPLE.COM")?.status).toBe("failed");
    expect(reservedTestRecipientDelivery("diver@example.com.")?.status).toBe("failed");
  });

  it("matches whole labels only, so a real domain that merely ends in a reserved word passes", () => {
    expect(reservedTestRecipientDelivery("diver@contest.com")).toBeNull();
    expect(reservedTestRecipientDelivery("diver@myexample.com")).toBeNull();
    expect(reservedTestRecipientDelivery("diver@example.company")).toBeNull();
  });

  it("reads the domain after the last @, so a quoted local part cannot smuggle one in", () => {
    expect(reservedTestRecipientDelivery('"a@example.com"@bluemantis.dive')).toBeNull();
    expect(reservedTestRecipientDelivery('"a@bluemantis.dive"@example.com')?.status).toBe("failed");
  });
});

describe("disabledNotificationProvider", () => {
  it("answers not_configured instead of throwing, whatever it is handed", async () => {
    const notification = { kind: "password_changed" } as unknown as Notification;
    await expect(disabledNotificationProvider.send(notification)).resolves.toEqual({
      status: "not_configured",
    });
    expect(disabledNotificationProvider.sendBatch).toBeUndefined();
  });
});
