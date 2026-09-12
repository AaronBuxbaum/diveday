import { describe, expect, it } from "vitest";
import {
  INBOUND_BODY_MAX_LENGTH,
  inboundReplyAddress,
  normalizeEmailAddress,
  normalizePhoneAddress,
  parseInboundReplyToken,
  phoneMatches,
  replyDestination,
  sesMessageIdFromHeader,
  truncateInboundBody,
  whatsAppReplyWindowOpen,
} from "./inbox";

const TOKEN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const DOMAIN = "inbound.ses.dive.day";

describe("normalizeEmailAddress", () => {
  it("takes the bare address out of a display-name header, lowercased", () => {
    expect(normalizeEmailAddress("Priya Sharma <Priya.Sharma@Example.com>")).toBe(
      "priya.sharma@example.com",
    );
    expect(normalizeEmailAddress("<priya@example.com>")).toBe("priya@example.com");
    expect(normalizeEmailAddress("  PRIYA@example.com ")).toBe("priya@example.com");
  });

  it("refuses anything that is not one address", () => {
    expect(normalizeEmailAddress("")).toBeNull();
    expect(normalizeEmailAddress(null)).toBeNull();
    expect(normalizeEmailAddress("not an address")).toBeNull();
    expect(normalizeEmailAddress("two words@example.com")).toBeNull();
  });

  /**
   * **The mailbox is the last angle-addr, not the first.** RFC 5322 lets a
   * display name be a quoted string holding anything at all, angle brackets
   * included, and this function became a security boundary the day
   * `/api/webhooks/email-inbound` started deciding *whose record a message
   * lands on* by comparing its answer against SES's DMARC verdict. SES
   * authenticates the real mailbox — the last angle-addr. Reading the first
   * one instead let anyone who owns a DMARC-passing domain write a sentence
   * onto a named diver's record: send from `mallory@evil.example` with the
   * victim's address parked in the display name, and the verdict that
   * authenticated `evil.example` was applied to `priya@example.com`.
   */
  it("reads the mailbox, not an address parked in the display name", () => {
    expect(normalizeEmailAddress('"Priya <priya@example.com>" <mallory@evil.example>')).toBe(
      "mallory@evil.example",
    );
    // The same shape after RFC 2047 decoding, which runs before this does.
    expect(normalizeEmailAddress("<priya@example.com> <mallory@evil.example>")).toBe(
      "mallory@evil.example",
    );
  });
});

describe("phoneMatches", () => {
  it("compares digits only, so a typed number and WhatsApp's bare one agree", () => {
    expect(phoneMatches("+1-305-555-0110", "13055550110", "US")).toBe(true);
    expect(phoneMatches("+1 (305) 555 0110", "13055550110", "US")).toBe(true);
  });

  it("resolves a bare national number against the shop's country, then compares", () => {
    expect(phoneMatches("305-555-0110", "13055550110", "US")).toBe(true);
    expect(phoneMatches("555-0110", "13055550110", "US")).toBe(false);
    expect(phoneMatches("", "13055550110", "US")).toBe(false);
    expect(phoneMatches(null, "13055550110", "US")).toBe(false);
  });

  it("reads a bare number against a country that is not North America", () => {
    expect(phoneMatches("612 345 678", "34612345678", "ES")).toBe(true);
    expect(phoneMatches("0612 345 678", "34612345678", "ES")).toBe(true);
    // The same stored digits in a US shop are not a Spanish number.
    expect(phoneMatches("612 345 678", "34612345678", "US")).toBe(false);
  });

  /**
   * **The wrong-linking failure the suffix rule allowed.** `phoneMatches` used
   * to accept any stored number of ten digits or more that the inbound number
   * *ended in* — the North American national-number length, applied to every
   * country. A London diver stored bare as `7700900123` therefore matched a US
   * inbound `+1 770 090 0123`: a stranger's message filed on a named diver's
   * record, for a shop that had done nothing wrong. Both directions stay shut.
   */
  it("never files a US inbound on a British record whose last ten digits collide", () => {
    expect(phoneMatches("7700900123", "17700900123", "GB")).toBe(false);
    expect(phoneMatches("+44 7700 900123", "17700900123", "GB")).toBe(false);
    expect(phoneMatches("7700900123", "447700900123", "GB")).toBe(true);
  });

  it("falls back to exact digits when the shop has no country on file", () => {
    expect(phoneMatches("+1-305-555-0110", "13055550110", null)).toBe(true);
    // Bare, with nothing to read it against: exact digits or nothing.
    expect(phoneMatches("305-555-0110", "13055550110", null)).toBe(false);
    expect(phoneMatches("3055550110", "3055550110", null)).toBe(true);
  });

  it("does not match a different number that merely shares a prefix", () => {
    expect(phoneMatches("+1-305-555-0111", "13055550110", "US")).toBe(false);
  });
});

describe("normalizePhoneAddress", () => {
  it("keeps digits and refuses a number too short to be one", () => {
    expect(normalizePhoneAddress("+1 305-555-0110")).toBe("13055550110");
    expect(normalizePhoneAddress("12345")).toBeNull();
    expect(normalizePhoneAddress(null)).toBeNull();
  });
});

/**
 * What a staffer reads above the composer before they send. A phone address is
 * stored digits-only, so the `+` has to come back — and nothing else does:
 * DiveDay does not know the country, and a guessed grouping would be a lie
 * about a number somebody is being asked to check.
 */
describe("replyDestination", () => {
  it("shows an email address exactly as it was received", () => {
    expect(replyDestination("email", "p.sharma@bigcorp.example")).toBe("p.sharma@bigcorp.example");
  });

  it("gives a stored phone address its plus back, and groups nothing", () => {
    expect(replyDestination("whatsapp", "13055550110")).toBe("+13055550110");
    expect(replyDestination("sms", "447700900123")).toBe("+447700900123");
  });

  it("does not double a plus that survived", () => {
    expect(replyDestination("whatsapp", "+13055550110")).toBe("+13055550110");
  });
});

describe("the inbound reply address", () => {
  it("round-trips the shop token through the address", () => {
    const address = inboundReplyAddress(TOKEN, DOMAIN);
    expect(address).toBe(`reply+${TOKEN}@${DOMAIN}`);
    expect(parseInboundReplyToken(address, DOMAIN)).toBe(TOKEN);
    expect(parseInboundReplyToken(`Shop <REPLY+${TOKEN.toUpperCase()}@${DOMAIN}>`, DOMAIN)).toBe(
      TOKEN,
    );
  });

  it("refuses another domain, another prefix, and a token that is not a uuid", () => {
    expect(parseInboundReplyToken(`reply+${TOKEN}@example.com`, DOMAIN)).toBeNull();
    expect(parseInboundReplyToken(`bounce+${TOKEN}@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(parseInboundReplyToken(`reply+not-a-token@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(parseInboundReplyToken(`reply+${TOKEN}x@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(parseInboundReplyToken(null, DOMAIN)).toBeNull();
  });
});

describe("whatsAppReplyWindowOpen", () => {
  const now = new Date("2026-07-21T13:30:00.000Z");

  it("is open inside 24 hours of the diver's last message and closed after", () => {
    expect(whatsAppReplyWindowOpen(new Date("2026-07-21T12:00:00.000Z"), now)).toBe(true);
    expect(whatsAppReplyWindowOpen(new Date("2026-07-20T13:30:01.000Z"), now)).toBe(true);
    expect(whatsAppReplyWindowOpen(new Date("2026-07-20T13:30:00.000Z"), now)).toBe(false);
  });

  it("is closed when the diver never wrote, or wrote from the future", () => {
    expect(whatsAppReplyWindowOpen(null, now)).toBe(false);
    expect(whatsAppReplyWindowOpen(new Date("2026-07-22T00:00:00.000Z"), now)).toBe(false);
  });
});

describe("truncateInboundBody", () => {
  it("normalises line endings, trims, and marks a cut", () => {
    expect(truncateInboundBody("  hi\r\nthere \n")).toBe("hi\nthere");
    const long = "x".repeat(INBOUND_BODY_MAX_LENGTH + 50);
    const kept = truncateInboundBody(long);
    expect(kept.length).toBe(INBOUND_BODY_MAX_LENGTH);
    expect(kept.endsWith("…")).toBe(true);
  });
});

describe("sesMessageIdFromHeader", () => {
  it("reads SES's own id out of an In-Reply-To header, in any region", () => {
    expect(sesMessageIdFromHeader("<0100019abc-1234-5678@email.amazonses.com>")).toBe(
      "0100019abc-1234-5678",
    );
    expect(sesMessageIdFromHeader("<abc@eu-west-1.amazonses.com>")).toBe("abc");
  });

  it("ignores any other sender's message id", () => {
    expect(sesMessageIdFromHeader("<abc@mail.gmail.com>")).toBeNull();
    expect(sesMessageIdFromHeader(null)).toBeNull();
    expect(sesMessageIdFromHeader("")).toBeNull();
  });
});
