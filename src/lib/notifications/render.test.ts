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
});
