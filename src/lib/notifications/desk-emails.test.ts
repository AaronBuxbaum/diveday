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
