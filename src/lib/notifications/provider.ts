import type { Notification } from "./kinds";

/**
 * The provider seam: what "send this" means, what came back, and the two
 * behaviours every provider owes regardless of vendor — refusing a reserved
 * test recipient, and degrading to "not configured" rather than throwing when
 * no credentials are set.
 */

export type NotificationDelivery =
  | { status: "sent"; providerMessageId: string }
  | { status: "not_configured" }
  | {
      status: "failed";
      retryable?: boolean;
      retryAfterMs?: number;
      httpStatus?: number;
      errorCode?: string;
      detail?: string;
    };

export interface NotificationProvider {
  send(notification: Notification): Promise<NotificationDelivery>;
  sendBatch?(notifications: Notification[]): Promise<NotificationDelivery[]>;
}

export type NotificationEnvironment = Readonly<Record<string, string | undefined>>;

const reservedTestEmailDomains = [
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "example",
  "invalid",
  "localhost",
  "test",
  // Demo credentials and seeded people are intentionally non-deliverable.
  // Keep this guard at the provider boundary so every mail path (including
  // deferred account invites and batch sends) gets the same protection.
  "demo.com",
];

export function reservedTestRecipientDelivery(to: string): NotificationDelivery | null {
  const domain = to
    .slice(to.lastIndexOf("@") + 1)
    .toLowerCase()
    .replace(/\.$/, "");
  const isReserved = reservedTestEmailDomains.some(
    (reservedDomain) => domain === reservedDomain || domain.endsWith(`.${reservedDomain}`),
  );
  if (!isReserved) return null;
  return {
    status: "failed",
    retryable: false,
    errorCode: "invalid_test_recipient",
    detail:
      "Reserved test domains such as example.com are blocked. Use a real recipient or an SES mailbox simulator address such as success@simulator.amazonses.com.",
  };
}

export const disabledNotificationProvider: NotificationProvider = {
  async send() {
    return { status: "not_configured" };
  },
};
