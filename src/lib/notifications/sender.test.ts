import { describe, expect, it } from "vitest";
import { shopSenderOf } from "./sender";

const nothing = {
  contactEmail: null,
  addressStreet: null,
  addressLocality: null,
  addressRegion: null,
  addressPostalCode: null,
  addressCountry: null,
};

describe("shopSenderOf (ADR 20260902-sender-standards-for-ses)", () => {
  it("reads the front-desk address as Reply-To and the street as one postal line", () => {
    expect(
      shopSenderOf({
        contactEmail: " desk@bluemantis.dive ",
        addressStreet: "1 Harbor Rd",
        addressLocality: "Key Largo",
        addressRegion: "FL",
        addressPostalCode: "33037",
        addressCountry: "US",
      }),
    ).toEqual({
      replyTo: "desk@bluemantis.dive",
      postalAddress: "1 Harbor Rd, Key Largo, FL 33037, US",
    });
  });

  it("is nothing at all for a shop with nothing on file", () => {
    expect(shopSenderOf(nothing)).toBeUndefined();
  });

  it("drops an address the notification schema would refuse rather than failing every send", () => {
    // The settings form allows ~470 characters across the five fields; the
    // schema caps the joined line at 300. Over it, the footer is the thing to
    // lose, not the booking confirmation.
    const long = {
      ...nothing,
      contactEmail: "desk@bluemantis.dive",
      addressStreet: "S".repeat(200),
      addressLocality: "L".repeat(120),
      addressRegion: "R".repeat(120),
      addressPostalCode: "P".repeat(20),
      addressCountry: "US",
    };
    expect(shopSenderOf(long)).toEqual({ replyTo: "desk@bluemantis.dive" });
    expect(shopSenderOf({ ...long, contactEmail: null })).toBeUndefined();
  });

  it("drops a contact address SES would refuse rather than sending the header", () => {
    expect(shopSenderOf({ ...nothing, contactEmail: "front desk" })).toBeUndefined();
    expect(shopSenderOf({ ...nothing, contactEmail: "front desk", addressCountry: "US" })).toEqual({
      postalAddress: "US",
    });
  });
});
