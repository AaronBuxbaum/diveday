import { describe, expect, it } from "vitest";
import type { Notification } from "./kinds";
import { messageFor } from "./render";

const ids = {
  bookingId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  shopId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
  userAccountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
};

const trip = {
  ...ids,
  to: "pat@bluemantis.dive",
  locale: "en-US" as const,
  diverName: "Pat Diver",
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-08-01T13:00:00.000Z"),
  endsAt: new Date("2026-08-01T17:00:00.000Z"),
  timezone: "America/New_York",
};

/**
 * The dispatch table itself is exhaustive by construction — a new kind is a
 * compile error — so what is pinned here is the chrome every body is wrapped
 * in, the two fall-backs for kinds that carry no shop or locale, and the one
 * kind that fans out to two bodies from one template.
 */
describe("messageFor", () => {
  it("wraps the body in the document chrome, in the reader's language, under the shop's name", () => {
    const email = messageFor({ kind: "booking_confirmation", ...trip });
    expect(email.subject).toBeTruthy();
    expect(email.text).toContain("Two-Tank Reef");
    expect(email.html.startsWith('<!doctype html><html lang="en-US">')).toBe(true);
    expect(email.html).toContain('class="dd-shop"');
    expect(email.html).toContain("Blue Mantis");
    expect(email.html).toContain("Two-Tank Reef");
    expect(email.html.endsWith("</html>")).toBe(true);
  });

  it("brands as DiveDay when the kind carries no shop to brand as", () => {
    const email = messageFor({
      kind: "password_changed",
      ...ids,
      to: "owner@bluemantis.dive",
      locale: "es-ES",
      ownerName: "Marisol Vega",
      changedAt: new Date("2026-08-01T13:00:00.000Z"),
    });
    expect(email.html.startsWith('<!doctype html><html lang="es-ES">')).toBe(true);
    expect(email.html).toContain('class="dd-shop"');
    expect(email.html).toMatch(/class="dd-shop"[^>]*>DiveDay</);
  });

  it("falls back to English chrome for the internal alert that has no locale", () => {
    const email = messageFor({
      kind: "new_account_alert",
      ...ids,
      to: "founder@diveday.app",
      ownerName: "Marisol Vega",
      ownerEmail: "marisol@bluemantis.dive",
      shopName: "Blue Mantis",
      shopSlug: "blue-mantis",
    });
    expect(email.html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(email.html).toMatch(/class="dd-shop"[^>]*>Blue Mantis</);
  });

  it("escapes the shop's name in the chrome rather than trusting it", () => {
    const email = messageFor({ kind: "booking_confirmation", ...trip, shopName: "Reef & <Co>" });
    expect(email.html).toContain("Reef &amp; &lt;Co&gt;");
    expect(email.html).not.toContain("<Co>");
  });

  it("renders the week-out and night-before reminders as two different mails", () => {
    const weekOut = messageFor({ kind: "trip_reminder_7d", ...trip });
    const nightBefore = messageFor({
      kind: "trip_reminder_24h",
      ...trip,
      brief: { forecast: "Light chop, 2 ft seas, 80 ft viz." },
    });
    expect(weekOut.html).not.toBe(nightBefore.html);
    expect(nightBefore.text).toContain("Light chop, 2 ft seas, 80 ft viz.");
    expect(weekOut.text).not.toContain("Light chop");
  });

  it("renders the same body whatever channel asks for it", () => {
    const notification: Notification = { kind: "booking_confirmation", ...trip };
    expect(messageFor(notification)).toEqual(messageFor({ ...notification }));
  });

  // ADR 20260902-sender-standards-for-ses: a commercial message names the
  // sender's postal address; a transactional one, and a shop with no street on
  // file, get nothing appended.
  describe("the postal footer", () => {
    const invite = {
      kind: "waitlist_invite" as const,
      waitlistEntryId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
      ...trip,
      bookingUrl: "https://dive.day/s/blue-mantis/trips/trip-1",
      invitedAt: new Date("2026-07-30T12:00:00.000Z"),
      unsubscribeUrl: "https://dive.day/unsubscribe/tok",
    };
    const sender = { postalAddress: "1 Harbor Rd, Key Largo, FL 33037, US" };

    it("closes a commercial message with the shop's name and address, in both bodies", () => {
      const email = messageFor({ ...invite, sender });
      expect(email.text.endsWith("\n\nBlue Mantis · 1 Harbor Rd, Key Largo, FL 33037, US\n")).toBe(
        true,
      );
      expect(email.html).toContain("Blue Mantis · 1 Harbor Rd, Key Largo, FL 33037, US</p>");
    });

    it("escapes the shop's own words on the way into the HTML", () => {
      const email = messageFor({ ...invite, shopName: "Reef & Wreck", sender });
      expect(email.html).toContain("Reef &amp; Wreck · 1 Harbor Rd");
    });

    it("appends nothing when the shop has no address on file", () => {
      const withNone = messageFor(invite);
      const withReplyOnly = messageFor({ ...invite, sender: { replyTo: "desk@bluemantis.dive" } });
      expect(withNone.text).toBe(withReplyOnly.text);
      expect(withNone.html).toBe(withReplyOnly.html);
      expect(withNone.html).not.toContain("font-size: 12px");
    });

    it("leaves a transactional message alone even when the address is known", () => {
      const email = messageFor({ kind: "booking_confirmation", ...trip, sender });
      expect(email.text).not.toContain("1 Harbor Rd");
      expect(email.html).not.toContain("1 Harbor Rd");
    });
  });
});
