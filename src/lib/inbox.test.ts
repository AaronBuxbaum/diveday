import { describe, expect, it } from "vitest";
import {
  INBOUND_BODY_MAX_LENGTH,
  inboundReplyAddress,
  normalizeEmailAddress,
  normalizePhoneAddress,
  parseInboundReplyToken,
  phoneMatches,
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
