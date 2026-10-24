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

  // ux review 2026-10-11, item 3: the shop's mail wears the shop.
  it("dresses a diver's mail in the shop's logo and colour, DiveDay at the foot, in their language", () => {
    const email = messageFor({
      kind: "booking_confirmation",
      ...trip,
      locale: "es-ES",
      sender: { logoUrl: "https://media.dive.day/logos/blue-mantis.png", brandColor: "#158462" },
    });
    expect(email.html).toContain('<img src="https://media.dive.day/logos/blue-mantis.png" alt=""');
    expect(email.html).toContain("Reservas con DiveDay");
    expect(email.html).not.toContain("background-color: #0b6e8a; border-radius: 12px");
  });

  // Visual review 2026-10-24, B31: one sign-off on every shop email.
  it("signs every shop email off the same way: name, then phone, then address", () => {
    const sender = { contactPhone: "+1 305 555 0142", contactEmail: "desk@bluemantis.dive" };
    const confirmation = messageFor({ kind: "booking_confirmation", ...trip, sender });
    const { diverName: _diverName, endsAt: _endsAt, userAccountId: _account, ...base } = trip;
    const reminder = messageFor({
      kind: "trip_reminder_24h",
      ...base,
      open: 1,
      sender,
      readinessUrl: "https://diveday.test/ready/abc.def",
    });
    for (const email of [confirmation, reminder]) {
      expect(email.text).toContain("\n\nBlue Mantis\n+1 305 555 0142\ndesk@bluemantis.dive\n");
      expect(email.html).toContain(
        '<p class="dd-signoff" style="margin-top: 24px;">Blue Mantis<br>+1 305 555 0142<br>desk@bluemantis.dive</p>',
      );
      expect(email.html.split('class="dd-signoff"')).toHaveLength(2);
    }
  });

  it("signs with the shop's name alone when it has no phone or confirmed address", () => {
    const email = messageFor({ kind: "booking_confirmation", ...trip });
    expect(email.text.endsWith("\n\nBlue Mantis\n")).toBe(true);
  });

  it("keeps DiveDay's own mark and no credit on DiveDay's own mail", () => {
    const email = messageFor({
      kind: "password_changed",
      ...ids,
      to: "owner@bluemantis.dive",
      locale: "en-US",
      ownerName: "Marisol Vega",
      changedAt: new Date("2026-08-01T13:00:00.000Z"),
    });
    expect(email.html).not.toContain("Bookings by DiveDay");
    expect(email.html).toContain("#ff6b6b");
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
      kind: "operator_alert",
      event: "new_account",
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
    const weekOut = messageFor({ kind: "trip_reminder_7d", ...trip, open: 0 });
    const nightBefore = messageFor({ kind: "trip_reminder_24h", ...trip, open: 0 });
    expect(weekOut.subject).not.toBe(nightBefore.subject);
    expect(weekOut.text).toContain("sails");
    expect(nightBefore.text).toContain("sails tomorrow");
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
      kind: "seat_offer_commercial" as const,
      askedBy: "diver" as const,
      interestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
      ...trip,
      bookingUrl: "https://dive.day/s/blue-mantis/trips/trip-1",
      offeredAt: new Date("2026-07-30T12:00:00.000Z"),
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

    it("says the deal, with its code and the list's own way out, when the offer carries one", () => {
      const email = messageFor({
        ...invite,
        askedBy: "shop",
        code: "SAVE25-ABC123",
        discountPercent: 25,
        expiresAt: new Date("2026-08-01T12:00:00.000Z"),
        sender,
      });
      expect(email.subject).toContain("25%");
      expect(email.text).toContain("SAVE25-ABC123");
      expect(email.text).toContain("https://dive.day/unsubscribe/tok");
      expect(email.text.endsWith("\n\nBlue Mantis · 1 Harbor Rd, Key Largo, FL 33037, US\n")).toBe(
        true,
      );
    });

    it("appends nothing when the shop has no address on file", () => {
      const withNone = messageFor(invite);
      const withReplyOnly = messageFor({ ...invite, sender: { replyTo: "desk@bluemantis.dive" } });
      expect(withNone.text).toBe(withReplyOnly.text);
      expect(withNone.html).toBe(withReplyOnly.html);
      expect(withNone.html).not.toContain("Blue Mantis · ");
    });

    /**
     * **A cold invitation is commercial; an answer to a request is not**
     * (Aaron, 2026-10-06, issue #1953). Same words, two kinds: the one staff
     * send to a diver who asked for nothing carries the unsubscribe and so the
     * postal footer; the reply to a diver's own date request carries neither.
     */
    describe("the two trip invitations", () => {
      const invitation = {
        ...trip,
        interestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3305",
        bookingUrl: "https://dive.day/s/blue-mantis/trips/trip-1",
        offeredAt: new Date("2026-07-30T12:00:00.000Z"),
      };

      it("closes a cold invitation with the unsubscribe link and the shop's address", () => {
        const email = messageFor({
          ...invitation,
          kind: "seat_offer_commercial",
          askedBy: "shop",
          unsubscribeUrl: "https://dive.day/unsubscribe/tok",
          sender,
        });
        expect(email.text).toContain(
          "Stop optional emails from Blue Mantis:\nhttps://dive.day/unsubscribe/tok",
        );
        expect(email.html).toContain(
          '<a href="https://dive.day/unsubscribe/tok">Stop optional emails from Blue Mantis</a>',
        );
        expect(
          email.text.endsWith("\n\nBlue Mantis · 1 Harbor Rd, Key Largo, FL 33037, US\n"),
        ).toBe(true);
        expect(email.html).toContain("Blue Mantis · 1 Harbor Rd, Key Largo, FL 33037, US</p>");
      });

      it("leaves the answer to a diver's own request without either", () => {
        const email = messageFor({
          ...invitation,
          kind: "seat_offer",
          answers: "date_request",
          sender,
        });
        expect(email.text).not.toContain("unsubscribe");
        expect(email.html).not.toContain("unsubscribe");
        expect(email.text).not.toContain("1 Harbor Rd");
        expect(email.html).not.toContain("1 Harbor Rd");
      });

      // H-145 D-2 option b (Aaron, 2026-10-17): the diver joined this
      // departure's wait list, so the seat is service mail in the wait list's words.
      it("tells a waiting diver a seat opened, with neither a way out nor the address", () => {
        const email = messageFor({
          ...invitation,
          kind: "seat_offer",
          answers: "wait_list",
          partySize: 2,
          sender,
        });
        expect(email.subject).toBe("2 seats opened up on Two-Tank Reef");
        expect(email.text).not.toContain("unsubscribe");
        expect(email.html).not.toContain("unsubscribe");
        expect(email.text).not.toContain("1 Harbor Rd");
        expect(email.html).not.toContain("1 Harbor Rd");
      });
    });

    it("leaves a transactional message alone even when the address is known", () => {
      const email = messageFor({ kind: "booking_confirmation", ...trip, sender });
      expect(email.text).not.toContain("1 Harbor Rd");
      expect(email.html).not.toContain("1 Harbor Rd");
    });
  });
});
