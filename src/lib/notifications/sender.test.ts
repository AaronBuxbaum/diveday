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

  it("drops a contact address SES would refuse rather than sending the header", () => {
    expect(shopSenderOf({ ...nothing, contactEmail: "front desk" })).toBeUndefined();
    expect(shopSenderOf({ ...nothing, contactEmail: "front desk", addressCountry: "US" })).toEqual({
      postalAddress: "US",
    });
  });
});
