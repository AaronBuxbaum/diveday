import { describe, expect, it } from "vitest";
import {
  createFeedToken,
  feedPath,
  feedSubscribeUrl,
  hashFeedToken,
  tokenFromFeedSegment,
} from "./feed-token";

describe("feed tokens", () => {
  it("mints a fresh high-entropy token each time", () => {
    const a = createFeedToken();
    const b = createFeedToken();
    expect(a).not.toBe(b);
    // 32 random bytes as base64url.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes deterministically and irreversibly", () => {
    const token = createFeedToken();
    expect(hashFeedToken(token)).toBe(hashFeedToken(token));
    expect(hashFeedToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFeedToken(token)).not.toContain(token);
  });

  it("round-trips a token through the URL segment, with or without the .ics suffix", () => {
    const token = createFeedToken();
    expect(tokenFromFeedSegment(`${token}.ics`)).toBe(token);
    expect(tokenFromFeedSegment(token)).toBe(token);
  });

  it("offers a webcal: form so Apple and Outlook subscribe instead of downloading once", () => {
    expect(feedSubscribeUrl("https://diveday.test", "abc")).toBe(
      "webcal://diveday.test/calendar/abc.ics",
    );
    expect(feedSubscribeUrl("http://localhost:3000", "abc")).toBe(
      "webcal://localhost:3000/calendar/abc.ics",
    );
    expect(feedPath("abc")).toBe("/calendar/abc.ics");
  });
});
