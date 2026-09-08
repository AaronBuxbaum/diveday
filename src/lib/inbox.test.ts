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
  it("compares digits only, so the seed's dashes and WhatsApp's bare number agree", () => {
    expect(phoneMatches("+1-305-555-0110", "13055550110")).toBe(true);
    expect(phoneMatches("+1 (305) 555 0110", "13055550110")).toBe(true);
  });

  it("accepts a stored number typed without its country code, but never a short suffix", () => {
    expect(phoneMatches("305-555-0110", "13055550110")).toBe(true);
    expect(phoneMatches("555-0110", "13055550110")).toBe(false);
    expect(phoneMatches("", "13055550110")).toBe(false);
    expect(phoneMatches(null, "13055550110")).toBe(false);
  });

  it("does not match a different number that merely shares a prefix", () => {
    expect(phoneMatches("+1-305-555-0111", "13055550110")).toBe(false);
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
