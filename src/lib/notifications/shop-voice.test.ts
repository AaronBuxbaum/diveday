import { describe, expect, it } from "vitest";
import type { Notification } from "./kinds";
import { encodeDisplayName, fromAddressFor, shopVoiceOf } from "./shop-voice";

const confirmation = {
  kind: "booking_confirmation",
  bookingId: "00000000-0000-4000-8000-000000000001",
  shopId: "00000000-0000-4000-8000-000000000010",
  to: "diver@dive.day",
  locale: "en-US",
  diverName: "Nora Quinn",
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-08-01T12:00:00.000Z"),
  endsAt: new Date("2026-08-01T15:00:00.000Z"),
  timezone: "America/New_York",
} as Notification;

const reset = {
  kind: "password_reset_request",
  userAccountId: "00000000-0000-4000-8000-000000000002",
  shopId: "00000000-0000-4000-8000-000000000010",
  to: "owner@dive.day",
  locale: "en-US",
  shopName: "Blue Mantis",
  resetUrl: "https://dive.day/reset-password/x",
  expiresAt: new Date("2026-08-01T12:00:00.000Z"),
  timezone: "America/New_York",
} as unknown as Notification;

/**
 * ux review 2026-10-11, item 3, and Aaron's sender decision: "{Shop} via
 * DiveDay" on DiveDay's own verified address, so DMARC keeps aligning on the
 * DiveDay domain while the diver reads the name of the shop they booked with.
 */
describe("fromAddressFor", () => {
  it("sends a diver's mail as the shop, via DiveDay, on the same address", () => {
    expect(fromAddressFor("DiveDay <noreply@ses.dive.day>", confirmation)).toBe(
      '"Blue Mantis via DiveDay" <noreply@ses.dive.day>',
    );
  });

  it("leaves DiveDay's own mail as DiveDay", () => {
    expect(fromAddressFor("DiveDay <noreply@ses.dive.day>", reset)).toBe(
      "DiveDay <noreply@ses.dive.day>",
    );
  });

  it("names a fork's configured sender after via, and keeps its address", () => {
    expect(fromAddressFor('"Reef Ops" <mail@reef.example>', confirmation)).toBe(
      '"Blue Mantis via Reef Ops" <mail@reef.example>',
    );
  });

  it("never changes the domain, whatever the shop is called", () => {
    const sneaky = { ...confirmation, shopName: "Evil <attacker@evil.example>" } as Notification;
    const from = fromAddressFor("DiveDay <noreply@ses.dive.day>", sneaky);
    expect(from.endsWith(" <noreply@ses.dive.day>")).toBe(true);
    // No second mailbox for a lenient parser to read as the sender.
    expect(from).toBe('"Evil attacker@evil.example via DiveDay" <noreply@ses.dive.day>');
  });
});

describe("encodeDisplayName", () => {
  it("quotes and escapes a plain name", () => {
    expect(encodeDisplayName('Sal "The Fish" \\ Sons')).toBe('"Sal \\"The Fish\\" \\\\ Sons"');
  });

  it("drops line breaks and bidi overrides, so a name can never add a header", () => {
    expect(encodeDisplayName("Reef\r\nBcc: x@evil.example")).toBe('"ReefBcc: x@evil.example"');
    expect(encodeDisplayName("Reef‮Line")).toBe('"ReefLine"');
  });

  it("encodes a name that is not ASCII as RFC 2047 words that decode back to it", () => {
    const name = "Buceo Señor Tiburón Caribe Azul Profundo via DiveDay";
    const encoded = encodeDisplayName(name);
    const words = encoded.split(" ");
    for (const word of words) {
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      expect(word.length).toBeLessThanOrEqual(75);
    }
    const decoded = words
      .map((word) => Buffer.from(word.slice(10, -2), "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe(name);
  });
});

describe("shopVoiceOf", () => {
  it("names the shop for a diver's mail and nobody for DiveDay's own", () => {
    expect(shopVoiceOf(confirmation)).toBe("Blue Mantis");
    expect(shopVoiceOf(reset)).toBeNull();
  });
});
