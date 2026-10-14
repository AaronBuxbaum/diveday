import { describe, expect, it } from "vitest";
import { notificationIdempotencyKey, notificationIsQueueable, notificationSchema } from "./kinds";
import { messageFor } from "./render";
import { rollCallStaleEmail } from "./roll-call-emails";

const base = {
  locale: "en-US" as const,
  recipientName: "Ana Ruiz",
  shopName: "Blue <Mantis>",
  tripTitle: "Two-Tank Reef",
  diveNumber: 2,
  unaccounted: 2,
  missing: false,
  rollCallUrl: "https://diveday.example/shop/blue/trips/t/manifest?checkpoint=after_dive_2",
};

/** Batch 6, item 6: the owner's alert for a roll call still open after the boat is due home. */
describe("rollCallStaleEmail", () => {
  it("names the departure, the dive and the count, and links the roll call", () => {
    const email = rollCallStaleEmail(base);
    expect(email.subject).toBe("Blue <Mantis>: roll call still open on Two-Tank Reef");
    expect(email.text).toContain("Hi Ana");
    expect(email.text).toContain(
      "The roll call after dive 2 on Two-Tank Reef is still open half an hour after the boat was due back. 2 people are not marked aboard.",
    );
    expect(email.html).toContain(`href="${base.rollCallUrl.replaceAll("&", "&amp;")}"`);
  });

  it("says a stated missing person in its own words", () => {
    const email = rollCallStaleEmail({ ...base, missing: true, unaccounted: 1 });
    expect(email.text).toContain(
      "On Two-Tank Reef, 1 person is recorded not back aboard after dive 2, half an hour after the boat was due back.",
    );
  });

  it("speaks the owner's language", () => {
    expect(rollCallStaleEmail({ ...base, locale: "es-ES" }).subject).toBe(
      "Blue <Mantis>: pase de lista aún abierto en Two-Tank Reef",
    );
  });

  it("escapes what it interpolates into the html", () => {
    const email = rollCallStaleEmail({ ...base, tripTitle: "<b>Reef</b>" });
    expect(email.html).not.toContain("<b>Reef</b>");
    expect(email.html).toContain("&lt;b&gt;Reef&lt;/b&gt;");
  });
});

describe("the roll_call_stale kind", () => {
  const notification = notificationSchema.parse({
    kind: "roll_call_stale",
    shopId: "11111111-1111-4111-8111-111111111111",
    personId: "22222222-2222-4222-8222-222222222222",
    tripId: "33333333-3333-4333-8333-333333333333",
    to: "ana@example.com",
    ...base,
    alertedAt: new Date("2026-10-14T17:00:00Z"),
  });

  it("carries counts and a link, never a name of anybody unaccounted for", () => {
    expect(Object.keys(notification).sort()).toEqual(
      [
        "alertedAt",
        "diveNumber",
        "kind",
        "locale",
        "missing",
        "personId",
        "recipientName",
        "rollCallUrl",
        "shopId",
        "shopName",
        "to",
        "tripId",
        "tripTitle",
        "unaccounted",
      ].sort(),
    );
  });

  it("goes once per departure per owner, and is never queued to arrive late", () => {
    expect(notificationIdempotencyKey(notification)).toBe(
      "roll-call-stale/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222",
    );
    expect(notificationIsQueueable(notification)).toBe(false);
  });

  it("renders through the one message path", () => {
    expect(messageFor(notification).subject).toBe(
      "Blue <Mantis>: roll call still open on Two-Tank Reef",
    );
  });
});
