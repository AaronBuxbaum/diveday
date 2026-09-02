import { describe, expect, it } from "vitest";
import { deliverableShopContactEmail, shopSenderOf } from "./sender";

const CONFIRMED = new Date("2026-09-01T12:00:00Z");

const nothing = {
  contactEmail: null,
  contactEmailConfirmedAt: null,
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
        contactEmailConfirmedAt: CONFIRMED,
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
      contactEmailConfirmedAt: CONFIRMED,
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
    expect(
      shopSenderOf({ ...nothing, contactEmail: "front desk", contactEmailConfirmedAt: CONFIRMED }),
    ).toBeUndefined();
    expect(
      shopSenderOf({
        ...nothing,
        contactEmail: "front desk",
        contactEmailConfirmedAt: CONFIRMED,
        addressCountry: "US",
      }),
    ).toEqual({ postalAddress: "US" });
  });

  /**
   * Issue #1288. Displaying the address on a public page is what this app has
   * always done; routing a diver's reply to it is a different act, and a diver
   * answering a waiver or readiness email writes back medical and contact
   * details. Until somebody opens the link sent to the address, it is a
   * manager's claim.
   */
  it("withholds Reply-To until the address has been confirmed", () => {
    const unconfirmed = { ...nothing, contactEmail: "desk@bluemantis.dive" };
    expect(shopSenderOf(unconfirmed)).toBeUndefined();
    expect(shopSenderOf({ ...unconfirmed, contactEmailConfirmedAt: CONFIRMED })).toEqual({
      replyTo: "desk@bluemantis.dive",
    });
  });

  it("still sends the postal footer for an unconfirmed shop — an address is not a destination", () => {
    expect(
      shopSenderOf({
        ...nothing,
        contactEmail: "desk@bluemantis.dive",
        addressStreet: "1 Harbor Rd",
        addressCountry: "US",
      }),
    ).toEqual({ postalAddress: "1 Harbor Rd, US" });
  });
});

/**
 * The predicate itself, separately from the header it gates — because it also
 * gates the date-request/course-inquiry send (`src/app/actions/inquiry.ts`),
 * which is the stronger case of the two. A `Reply-To` only leaks if a diver
 * hits reply; that mail pushes a diver's name, address, phone, experience and
 * free text into whatever is in the box, unprompted, from a public page.
 */
describe("deliverableShopContactEmail (issue #1288)", () => {
  it("is the address once it is confirmed", () => {
    expect(
      deliverableShopContactEmail({
        contactEmail: " Desk@BlueMantis.dive ",
        contactEmailConfirmedAt: CONFIRMED,
      }),
    ).toBe("Desk@BlueMantis.dive");
  });

  it("is null until it is confirmed", () => {
    expect(
      deliverableShopContactEmail({
        contactEmail: "desk@bluemantis.dive",
        contactEmailConfirmedAt: null,
      }),
    ).toBeNull();
  });

  it("is null for a shop with no address at all", () => {
    expect(
      deliverableShopContactEmail({ contactEmail: null, contactEmailConfirmedAt: CONFIRMED }),
    ).toBeNull();
  });

  it("is null for something that is not an address, confirmed or not", () => {
    expect(
      deliverableShopContactEmail({
        contactEmail: "front desk",
        contactEmailConfirmedAt: CONFIRMED,
      }),
    ).toBeNull();
  });
});
