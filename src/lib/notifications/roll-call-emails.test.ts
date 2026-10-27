import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TRIP_TITLE_MAX,
  notificationIdempotencyKey,
  notificationIsQueueable,
  notificationSchema,
  notificationTripTitle,
} from "./kinds";
import { messageFor } from "./render";
import {
  rollCallStaleEmail,
  rollCallStaleShoreEmail,
  shoreAlertConfirmationEmail,
  shoreAlertStoppedEmail,
} from "./roll-call-emails";

const base = {
  locale: "en-US" as const,
  recipientName: "Ana Ruiz",
  shopName: "Blue <Mantis>",
  tripTitle: "Two-Tank Reef",
  diveNumber: 2,
  notBackAboard: 0,
  awaiting: 2,
  rollCallUrl: "https://diveday.example/shop/blue/trips/t/manifest?checkpoint=after_dive_2",
  endsAt: new Date("2026-10-14T20:00:00Z"),
  timezone: "America/New_York",
  alertedAt: new Date("2026-10-14T21:06:00Z"),
};

/** Batch 6, item 6: the owner's alert for a roll call still open after the boat is due home. */
describe("rollCallStaleEmail", () => {
  it("names the departure, the dive and the count, and links the roll call", () => {
    const email = rollCallStaleEmail(base);
    // `keepUnitsWhole` joins "4:00 PM EDT" with no-break spaces.
    const text = email.text.replaceAll("\u00a0", " ");
    expect(email.subject).toBe("Blue <Mantis>: roll call still open on Two-Tank Reef");
    expect(email.text).toContain("Hi Ana");
    expect(text).toContain(
      "The roll call after dive 2 on Two-Tank Reef is still open after the boat was due back at 4:00 PM EDT. 2 people have no result yet: nobody has recorded them missing or back aboard.",
    );
    expect(text).not.toContain("not marked");
    expect(email.html).toContain(`href="${base.rollCallUrl.replaceAll("&", "&amp;")}"`);
  });

  it("says a stated missing person in its own words", () => {
    const email = rollCallStaleEmail({ ...base, notBackAboard: 1, awaiting: 0 });
    expect(email.text.replaceAll("\u00a0", " ")).toContain(
      "is still open after the boat was due back at 4:00 PM EDT. 1 person is recorded not back aboard.",
    );
  });

  // Dive-domain review (EAP) on H-118: one missing diver beside five with no
  // result must not read as "1 person".
  it("says both numbers when some are recorded missing and more have no result", () => {
    const email = rollCallStaleEmail({ ...base, notBackAboard: 1, awaiting: 6 });
    expect(email.text).toContain(
      "1 person is recorded not back aboard; 6 more have no result yet: nobody has recorded them missing or back aboard.",
    );
    const es = rollCallStaleEmail({ ...base, locale: "es-ES", notBackAboard: 2, awaiting: 1 });
    expect(es.text).toContain(
      "2 personas constan como no de vuelta a bordo; 1 más sigue sin resultado",
    );
  });

  it("speaks the owner's language", () => {
    expect(rollCallStaleEmail({ ...base, locale: "es-ES" }).subject).toBe(
      "Blue <Mantis>: pase de lista aún abierto en Two-Tank Reef",
    );
  });

  it("names the time the boat was due back, never a wait the hourly pass cannot keep", () => {
    // Dive-domain review 20261014: the pass is hourly and an unstarted count
    // opens an hour past the end, so "half an hour after" was not true.
    const email = rollCallStaleEmail({ ...base, locale: "es-ES" });
    expect(email.text).toContain("pasada la hora de regreso del barco (16:00");
    expect(email.text).not.toMatch(/media hora|half an hour/);
  });

  // Dive-domain re-review #4: a pass after midnight must not read as today.
  it("dates the time the boat was due back when that was not the day it is sent", () => {
    const nextDay = { ...base, alertedAt: new Date("2026-10-15T05:06:00Z") };
    expect(rollCallStaleEmail(nextDay).text.replaceAll("\u00a0", " ")).toContain(
      "is still open after the boat was due back on Wed, Oct 14 at 4:00 PM EDT.",
    );
    expect(
      rollCallStaleEmail({ ...nextDay, locale: "es-ES" }).text.replaceAll("\u00a0", " "),
    ).toContain("pasada la hora de regreso del barco (mié, 14 oct, 16:00");
  });

  it("escapes what it interpolates into the html", () => {
    const email = rollCallStaleEmail({ ...base, tripTitle: "<b>Reef</b>" });
    expect(email.html).not.toContain("<b>Reef</b>");
    expect(email.html).toContain("&lt;b&gt;Reef&lt;/b&gt;");
  });
});

describe("notificationTripTitle", () => {
  it("leaves a title that fits alone", () => {
    expect(notificationTripTitle("  Two-Tank Reef ")).toBe("Two-Tank Reef");
  });

  it("clips an unbounded title so the kind still parses (security review 20261014)", () => {
    const clipped = notificationTripTitle("Reef ".repeat(100));
    expect(clipped.length).toBeLessThanOrEqual(NOTIFICATION_TRIP_TITLE_MAX);
    expect(clipped.endsWith("…")).toBe(true);
    expect(() =>
      notificationSchema.parse({
        kind: "roll_call_stale",
        shopId: "11111111-1111-4111-8111-111111111111",
        personId: "22222222-2222-4222-8222-222222222222",
        tripId: "33333333-3333-4333-8333-333333333333",
        to: "ana@example.com",
        ...base,
        tripTitle: clipped,
        alertedAt: new Date("2026-10-14T17:00:00Z"),
      }),
    ).not.toThrow();
  });

  it("never splits an emoji at the cut", () => {
    const clipped = notificationTripTitle(`${"a".repeat(NOTIFICATION_TRIP_TITLE_MAX - 2)}🐠🐠🐠`);
    expect(clipped).toBe(`${"a".repeat(NOTIFICATION_TRIP_TITLE_MAX - 2)}…`);
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

  it("can send an open fifth-dive roll call to an owner", () => {
    const fifth = notificationSchema.safeParse({ ...notification, diveNumber: 5 });
    expect(fifth.success).toBe(true);
    if (fifth.success) expect(messageFor(fifth.data).text).toContain("after dive 5");
  });

  it("carries counts and a link, never a name of anybody unaccounted for", () => {
    expect(Object.keys(notification).sort()).toEqual(
      [
        "alertedAt",
        "endsAt",
        "diveNumber",
        "kind",
        "locale",
        "notBackAboard",
        "personId",
        "recipientName",
        "rollCallUrl",
        "shopId",
        "shopName",
        "to",
        "tripId",
        "timezone",
        "tripTitle",
        "awaiting",
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

/** H-118: the shore contact's copy, to somebody outside the shop's accounts. */
describe("the roll_call_stale_shore kind", () => {
  const { recipientName: _name, rollCallUrl: _url, ...facts } = base;
  const shore = {
    ...facts,
    shopPhone: "+1 305 555 0100",
    alertedAt: new Date("2026-10-14T21:06:00Z"),
    stopUrl: "https://diveday.example/unsubscribe/stop-token",
  };
  const notification = notificationSchema.parse({
    kind: "roll_call_stale_shore",
    shopId: "11111111-1111-4111-8111-111111111111",
    tripId: "33333333-3333-4333-8333-333333333333",
    to: "shore@example.com",
    ...shore,
  });
  const plain = (text: string) => text.replaceAll("\u00a0", " ");

  it("can send an open fifth-dive roll call to the shore contact", () => {
    const fifth = notificationSchema.safeParse({ ...notification, diveNumber: 5 });
    expect(fifth.success).toBe(true);
    if (fifth.success) expect(messageFor(fifth.data).text).toContain("after dive 5");
  });

  it("names the shop, the departure, the dive, both counts and the time", () => {
    const email = rollCallStaleShoreEmail({ ...shore, notBackAboard: 1, awaiting: 2 });
    expect(email.subject).toBe("Blue <Mantis>: roll call still open on Two-Tank Reef");
    expect(plain(email.text)).toContain(
      "The roll call after dive 2 on Two-Tank Reef is still open after the boat was due back at 4:00 PM EDT. 1 person is recorded not back aboard; 2 more have no result yet",
    );
    expect(email.text).toContain("Blue <Mantis> lists you as its shore contact");
    expect(email.html).toContain("Blue &lt;Mantis&gt; lists you");
  });

  // Dive-domain review (EAP #2): the reader has to know what to do, when this
  // was true, and that nothing follows it.
  it("says to call the shop first, on its number, when it was sent, and that nothing follows", () => {
    const text = plain(rollCallStaleShoreEmail(shore).text);
    expect(text).toContain("Call Blue <Mantis> first, on +1 305 555 0100.");
    expect(text).toContain("Sent Oct 14, 5:06 PM EDT.");
    expect(text).toContain("the only message you will get about this departure");
    // Dive-domain re-review #8: silence is not the all-clear; the shop is.
    expect(text).toContain("DiveDay sends no all-clear; ask Blue <Mantis>.");
    const noPhone = plain(rollCallStaleShoreEmail({ ...shore, shopPhone: null }).text);
    expect(noPhone).toContain("Call Blue <Mantis> first.");
  });

  it("carries one link, the one that stops these alerts, and no person", () => {
    const email = rollCallStaleShoreEmail(shore);
    expect(email.html.match(/href=/g)).toHaveLength(1);
    expect(email.html).toContain(`href="${shore.stopUrl}"`);
    expect(email.text.match(/https?:\/\/\S+/g)).toEqual([shore.stopUrl]);
    expect(email.text).not.toContain("Ana");
    expect(Object.keys(notification).sort()).toEqual(
      [
        "alertedAt",
        "awaiting",
        "endsAt",
        "diveNumber",
        "kind",
        "locale",
        "notBackAboard",
        "shopId",
        "shopName",
        "shopPhone",
        "stopUrl",
        "to",
        "tripId",
        "timezone",
        "tripTitle",
      ].sort(),
    );
    expect(messageFor(notification).text).not.toContain("Ana");
  });

  it("says a stated missing person, in the shop's language", () => {
    const email = rollCallStaleShoreEmail({
      ...shore,
      locale: "es-ES",
      notBackAboard: 1,
      awaiting: 0,
    });
    expect(email.subject).toBe("Blue <Mantis>: pase de lista aún abierto en Two-Tank Reef");
    expect(email.text).toContain("consta como no de vuelta a bordo");
    expect(email.text).toContain("contacto en tierra");
    expect(email.text).toContain("Llama primero a Blue <Mantis>");
  });

  it("goes once per departure, and is never queued to arrive late", () => {
    expect(notificationIdempotencyKey(notification)).toBe(
      "roll-call-stale-shore/33333333-3333-4333-8333-333333333333",
    );
    expect(notificationIsQueueable(notification)).toBe(false);
  });
});

/** H-118 review: the link a saved shore address receives before any alert. */
describe("the shore_alert_confirmation kind", () => {
  const input = {
    locale: "en-US" as const,
    shopName: "Blue <Mantis>",
    confirmUrl: "https://diveday.example/confirm-contact/abc",
    expiresAt: new Date("2026-10-22T16:00:00Z"),
    timezone: "America/New_York",
  };

  it("says what agreeing means, links the confirm page and says how to ignore it", () => {
    const email = shoreAlertConfirmationEmail(input);
    expect(email.subject).toBe("Blue <Mantis> asks you to be its shore contact");
    expect(email.text).toContain(input.confirmUrl);
    expect(email.text).toContain("roll call");
    expect(email.text).toContain("ignore");
    expect(email.html).toContain("Blue &lt;Mantis&gt;");
    expect(shoreAlertConfirmationEmail({ ...input, locale: "es-ES" }).subject).toBe(
      "Blue <Mantis> te pide ser su contacto en tierra",
    );
  });

  it("goes once per link, and is never queued", () => {
    const notification = notificationSchema.parse({
      kind: "address_confirmation",
      purpose: "shore_alert",
      shopId: "11111111-1111-4111-8111-111111111111",
      tokenId: "44444444-4444-4444-8444-444444444444",
      to: "shore@example.com",
      ...input,
    });
    expect(notificationIdempotencyKey(notification)).toBe(
      "shore-alert-confirmation/44444444-4444-4444-8444-444444444444",
    );
    expect(notificationIsQueueable(notification)).toBe(false);
  });
});

/** H-118 re-review: the owners hear when the shore contact stopped the alerts. */
describe("the shore_alert_stopped kind", () => {
  const input = {
    locale: "en-US" as const,
    recipientName: "Ana Ruiz",
    shopName: "Blue <Mantis>",
    settingsUrl: "https://diveday.example/shop/blue/settings/emergency-reference",
  };

  it("says the shore contact stopped them and what brings them back, in both languages", () => {
    const email = shoreAlertStoppedEmail(input);
    expect(email.subject).toBe("Blue <Mantis>: the shore contact stopped roll-call alerts");
    expect(email.text).toContain("Hi Ana");
    expect(email.text).toContain("confirm it again");
    expect(email.text).toContain(input.settingsUrl);
    expect(shoreAlertStoppedEmail({ ...input, locale: "es-ES" }).subject).toBe(
      "Blue <Mantis>: el contacto en tierra dejó los avisos del pase de lista",
    );
  });

  it("goes once per owner per stop, from DiveDay", () => {
    const notification = notificationSchema.parse({
      kind: "shore_alert_stopped",
      shopId: "11111111-1111-4111-8111-111111111111",
      personId: "22222222-2222-4222-8222-222222222222",
      to: "owner@example.com",
      stoppedAt: new Date("2026-10-15T12:00:00Z"),
      ...input,
    });
    expect(notificationIdempotencyKey(notification)).toBe(
      "shore-alert-stopped/22222222-2222-4222-8222-222222222222/2026-10-15T12:00:00.000Z",
    );
    expect(messageFor(notification).subject).toBe(
      "Blue <Mantis>: the shore contact stopped roll-call alerts",
    );
  });
});
