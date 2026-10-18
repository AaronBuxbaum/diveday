import { describe, expect, it } from "vitest";
import { deskAfterHoursEmail } from "./desk-emails";
import { notificationIdempotencyKey, notificationIsQueueable, notificationSchema } from "./kinds";
import { messageFor } from "./render";

const base = {
  locale: "en-US" as const,
  recipientName: "Ana Ruiz",
  shopName: "Blue <Mantis>",
  inboxUrl: "https://diveday.example/shop/blue/inbox",
  settingsUrl: "https://diveday.example/shop/blue/settings/email",
};

describe("deskAfterHoursEmail", () => {
  it("names how many divers are waiting and links the Inbox", () => {
    const email = deskAfterHoursEmail({ ...base, waiting: 2 });
    expect(email.subject).toBe("Blue <Mantis>: 2 divers wrote in after hours");
    expect(email.text).toContain("Hi Ana");
    expect(email.text).toContain("2 divers wrote in after hours.");
    expect(email.text).toContain(base.inboxUrl);
    expect(email.text).toContain(base.settingsUrl);
    expect(email.html).toContain(`href="${base.inboxUrl}"`);
  });

  it("says one diver as one", () => {
    expect(deskAfterHoursEmail({ ...base, waiting: 1 }).subject).toBe(
      "Blue <Mantis>: 1 diver wrote in after hours",
    );
  });

  it("speaks the staffer's language", () => {
    const email = deskAfterHoursEmail({ ...base, locale: "es-ES", waiting: 3 });
    expect(email.subject).toBe("Blue <Mantis>: 3 buceadores escribieron fuera de horario");
  });

  it("escapes what it interpolates into the html", () => {
    const email = deskAfterHoursEmail({ ...base, recipientName: "<b>Ana</b> Ruiz", waiting: 2 });
    expect(email.html).not.toContain("<b>Ana</b>");
    expect(email.html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
  });
});

describe("the desk_after_hours kind", () => {
  const notification = notificationSchema.parse({
    kind: "desk_after_hours",
    shopId: "11111111-1111-4111-8111-111111111111",
    personId: "22222222-2222-4222-8222-222222222222",
    to: "ana@example.com",
    ...base,
    waiting: 2,
    pingedAt: new Date("2026-10-10T01:00:00Z"),
  });

  it("carries no field a message's sender or words could ride in", () => {
    // The payload is the whole of what reaches a personal inbox; the words a
    // diver wrote never do.
    expect(Object.keys(notification).sort()).toEqual(
      [
        "inboxUrl",
        "kind",
        "locale",
        "personId",
        "pingedAt",
        "recipientName",
        "settingsUrl",
        "shopId",
        "shopName",
        "to",
        "waiting",
      ].sort(),
    );
  });

  it("is keyed per claim, rendered by its own body, and never queued", () => {
    expect(notificationIdempotencyKey(notification)).toBe(
      "desk-after-hours/22222222-2222-4222-8222-222222222222/2026-10-10T01:00:00.000Z",
    );
    expect(notificationIsQueueable(notification)).toBe(false);
    expect(messageFor(notification).subject).toBe("Blue <Mantis>: 2 divers wrote in after hours");
  });

  it("refuses a ping about nobody", () => {
    expect(() => notificationSchema.parse({ ...notification, waiting: 0 })).toThrow();
  });
});

describe("the stripe_payments_restricted kind", () => {
  const notification = notificationSchema.parse({
    kind: "stripe_payments_restricted",
    shopId: "11111111-1111-4111-8111-111111111111",
    personId: "22222222-2222-4222-8222-222222222222",
    to: "ana@example.com",
    locale: "en-US",
    recipientName: "Ana Ruiz",
    shopName: "Blue <Mantis>",
    settingsUrl: "https://diveday.example/shop/blue/settings#money",
    restrictedAt: new Date("2026-10-14T12:00:00Z"),
  });

  it("says payments are off, that divers pay at the shop, and links payment settings", () => {
    const email = messageFor(notification);
    expect(email.subject).toBe("Blue <Mantis>: Stripe has turned off card payments");
    expect(email.text).toContain("Hi Ana");
    expect(email.text).toContain("pay at the shop");
    expect(email.html).toContain('href="https://diveday.example/shop/blue/settings#money"');
    expect(email.html).not.toContain("<Mantis>");
  });

  it("is keyed per owner per restriction, so a redelivery is the same send", () => {
    expect(notificationIdempotencyKey(notification)).toBe(
      "stripe-payments-restricted/22222222-2222-4222-8222-222222222222/2026-10-14T12:00:00.000Z",
    );
    expect(notificationIsQueueable(notification)).toBe(true);
  });

  it("speaks the owner's language", () => {
    const spanish = notificationSchema.parse({ ...notification, locale: "es-ES" });
    expect(messageFor(spanish).subject).toBe(
      "Blue <Mantis>: Stripe desactivó los pagos con tarjeta",
    );
  });
});

describe("the move_ask_soon kind", () => {
  const notification = notificationSchema.parse({
    kind: "move_ask_soon",
    shopId: "11111111-1111-4111-8111-111111111111",
    personId: "22222222-2222-4222-8222-222222222222",
    messageId: "33333333-3333-4333-8333-333333333333",
    to: "ana@example.com",
    locale: "en-US",
    recipientName: "Ana Ruiz",
    shopName: "Blue <Mantis>",
    tripTitle: "Two-tank <reef>",
    startsAt: new Date("2026-10-18T14:00:00Z"),
    timezone: "Pacific/Auckland",
    inboxUrl: "https://diveday.example/shop/blue/inbox",
    askedAt: new Date("2026-10-18T02:00:00Z"),
  });

  it("names the departure and its time in the shop's zone, and links the Inbox", () => {
    const email = messageFor(notification);
    expect(email.subject).toBe("Blue <Mantis>: a diver asked to move off Two-tank <reef>");
    expect(email.text).toContain("Hi Ana");
    expect(email.text).toContain("Two-tank <reef>");
    // 14:00Z is 3:00 the next morning in Auckland.
    expect(email.text).toMatch(/Oct(ober)?\s19,\s3:00\sAM/);
    expect(email.html).toContain('href="https://diveday.example/shop/blue/inbox"');
    expect(email.html).not.toContain("<reef>");
  });

  it("carries no field the diver or their words could ride in", () => {
    expect(Object.keys(notification).sort()).toEqual(
      [
        "askedAt",
        "inboxUrl",
        "kind",
        "locale",
        "messageId",
        "personId",
        "recipientName",
        "shopId",
        "shopName",
        "startsAt",
        "timezone",
        "to",
        "tripTitle",
      ].sort(),
    );
  });

  it("is keyed per ask per staffer, and never queued", () => {
    expect(notificationIdempotencyKey(notification)).toBe(
      "move-ask-soon/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/2026-10-18T02:00:00.000Z",
    );
    expect(notificationIsQueueable(notification)).toBe(false);
  });

  it("speaks the staffer's language", () => {
    const spanish = notificationSchema.parse({ ...notification, locale: "es-ES" });
    expect(messageFor(spanish).subject).toBe(
      "Blue <Mantis>: un buceador pidió cambiar de Two-tank <reef>",
    );
  });
});
