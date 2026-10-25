import { describe, expect, it } from "vitest";
import { emailLogoUrl, shopSenderOf } from "./sender";

/** Inbound mail switched off, so these cases read the front-desk rule on its own. */
const off = { EMAIL_INBOUND_DOMAIN: "" };

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
      shopSenderOf(
        {
          contactEmail: " desk@bluemantis.dive ",
          contactEmailConfirmedAt: new Date("2026-09-01T12:00:00.000Z"),
          addressStreet: "1 Harbor Rd",
          addressLocality: "Key Largo",
          addressRegion: "FL",
          addressPostalCode: "33037",
          addressCountry: "US",
        },
        off,
      ),
    ).toEqual({
      replyTo: "desk@bluemantis.dive",
      contactEmail: "desk@bluemantis.dive",
      postalAddress: "1 Harbor Rd, Key Largo, FL 33037, US",
    });
  });

  // Visual review 2026-10-24, B31: the sign-off every shop email ends on.
  it("carries the shop's phone and confirmed address for the sign-off", () => {
    expect(shopSenderOf({ ...nothing, contactPhone: " +1 305 555 0142 " }, off)).toEqual({
      contactPhone: "+1 305 555 0142",
    });
    expect(shopSenderOf({ ...nothing, contactPhone: "  " }, off)).toBeUndefined();
    // One printable line, or nothing: a newline could fake a line in the sign-off.
    expect(shopSenderOf({ ...nothing, contactPhone: "555\nPay to: x" }, off)).toBeUndefined();
    expect(shopSenderOf({ ...nothing, contactEmail: "desk@bluemantis.dive" }, off)).toBeUndefined();
  });

  it("is nothing at all for a shop with nothing on file", () => {
    expect(shopSenderOf(nothing, off)).toBeUndefined();
    expect(shopSenderOf({ ...nothing, isDemo: false }, off)).toBeUndefined();
  });

  it("marks a demo shop's sends, so its seeded people's mail reaches the SES simulator", () => {
    expect(shopSenderOf({ ...nothing, isDemo: true }, off)).toEqual({ demoShop: true });
  });

  // Issue #2450: a name that could pass for a brand is held for review.
  it("marks a shop whose name is under review, until a later clearing", () => {
    const flagged = new Date("2026-10-01T12:00:00.000Z");
    const held = { ...nothing, nameFlaggedAt: flagged, nameClearedAt: null };
    expect(shopSenderOf(held, off)).toEqual({ nameUnderReview: true });
    const cleared = { ...held, nameClearedAt: new Date("2026-10-02T12:00:00.000Z") };
    expect(shopSenderOf(cleared, off)).toBeUndefined();
    const reflagged = { ...cleared, nameFlaggedAt: new Date("2026-10-03T12:00:00.000Z") };
    expect(shopSenderOf(reflagged, off)).toEqual({ nameUnderReview: true });
  });

  // Issue #1288: a typed address is not a proven one. Until the shop opens the
  // link sent to it, diver replies must not be routed there.
  it("withholds Reply-To from an address the shop has not confirmed", () => {
    expect(
      shopSenderOf(
        {
          ...nothing,
          contactEmail: "desk@bluemantis.dive",
          contactEmailConfirmedAt: null,
        },
        off,
      ),
    ).toBeUndefined();
    expect(
      shopSenderOf(
        {
          ...nothing,
          contactEmail: "desk@bluemantis.dive",
          contactEmailConfirmedAt: null,
          addressCountry: "US",
        },
        off,
      ),
    ).toEqual({ postalAddress: "US" });
    expect(
      shopSenderOf(
        {
          ...nothing,
          contactEmail: "desk@bluemantis.dive",
          contactEmailConfirmedAt: new Date("2026-09-01T12:00:00.000Z"),
        },
        off,
      ),
    ).toEqual({ replyTo: "desk@bluemantis.dive", contactEmail: "desk@bluemantis.dive" });
  });

  it("drops an address the notification schema would refuse rather than failing every send", () => {
    // The settings form allows ~470 characters across the five fields; the
    // schema caps the joined line at 300. Over it, the footer is the thing to
    // lose, not the booking confirmation.
    const long = {
      ...nothing,
      contactEmail: "desk@bluemantis.dive",
      contactEmailConfirmedAt: new Date("2026-09-01T12:00:00.000Z"),
      addressStreet: "S".repeat(200),
      addressLocality: "L".repeat(120),
      addressRegion: "R".repeat(120),
      addressPostalCode: "P".repeat(20),
      addressCountry: "US",
    };
    expect(shopSenderOf(long, off)).toEqual({
      replyTo: "desk@bluemantis.dive",
      contactEmail: "desk@bluemantis.dive",
    });
    expect(shopSenderOf({ ...long, contactEmail: null }, off)).toBeUndefined();
  });

  // ADR 20260907-two-way-inbox: replies route back into the app.
  it("prefers the shop's inbound reply address over the front desk, and falls back when inbound is off", () => {
    const token = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const shop = {
      ...nothing,
      inboundEmailToken: token,
      contactEmail: "desk@bluemantis.dive",
      contactEmailConfirmedAt: new Date("2026-09-01T12:00:00.000Z"),
    };
    expect(shopSenderOf(shop, {})).toEqual({
      replyTo: `reply+${token}@inbound.ses.dive.day`,
      contactEmail: "desk@bluemantis.dive",
    });
    // An unconfirmed front desk changes nothing about the inbound address.
    expect(shopSenderOf({ ...shop, contactEmailConfirmedAt: null }, {})).toEqual({
      replyTo: `reply+${token}@inbound.ses.dive.day`,
    });
    // Inbound switched off: the confirmed front desk, and its proof rule.
    expect(shopSenderOf(shop, { EMAIL_INBOUND_DOMAIN: "" })).toEqual({
      replyTo: "desk@bluemantis.dive",
      contactEmail: "desk@bluemantis.dive",
    });
    expect(
      shopSenderOf({ ...shop, contactEmailConfirmedAt: null }, { EMAIL_INBOUND_DOMAIN: "" }),
    ).toBeUndefined();
  });

  it("drops a contact address SES would refuse rather than sending the header", () => {
    const confirmed = new Date("2026-09-01T12:00:00.000Z");
    expect(
      shopSenderOf(
        { ...nothing, contactEmail: "front desk", contactEmailConfirmedAt: confirmed },
        off,
      ),
    ).toBeUndefined();
    expect(
      shopSenderOf(
        {
          ...nothing,
          contactEmail: "front desk",
          contactEmailConfirmedAt: confirmed,
          addressCountry: "US",
        },
        off,
      ),
    ).toEqual({ postalAddress: "US" });
  });
});

// ux review 2026-10-11, item 3: the email leads with the shop's own mark.
describe("the shop's logo and colour on its mail", () => {
  const env = {
    ...off,
    APP_HOST: "https://dive.day",
    MEDIA_PUBLIC_URL_BASE: "https://media.dive.day",
  };

  it("carries a logo our own storage holds, and the brand colour", () => {
    expect(
      shopSenderOf(
        { ...nothing, logoUrl: "https://media.dive.day/logos/a.png", brandColor: "#158462" },
        env,
      ),
    ).toEqual({ logoUrl: "https://media.dive.day/logos/a.png", brandColor: "#158462" });
  });

  it("puts a root-relative logo on DiveDay's own origin", () => {
    expect(emailLogoUrl("/dive-sites/logo.png", env)).toBe("https://dive.day/dive-sites/logo.png");
  });

  it("refuses a logo on anybody else's host, so a diver's client never fetches from one", () => {
    expect(emailLogoUrl("https://tracker.example/pixel.png", env)).toBeNull();
    expect(emailLogoUrl("//tracker.example/pixel.png", env)).toBeNull();
    expect(emailLogoUrl("http://media.dive.day/logos/a.png", env)).toBeNull();
  });

  it("drops a colour that is not one", () => {
    expect(shopSenderOf({ ...nothing, brandColor: "red; background:url(x)" }, env)).toBeUndefined();
  });
});
