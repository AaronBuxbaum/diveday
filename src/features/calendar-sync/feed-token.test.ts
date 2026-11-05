import { describe, expect, it } from "vitest";
import { createBearerToken } from "@/lib/bearer-tokens";
import { feedPath, feedSubscribeUrl, tokenFromFeedSegment } from "./feed-token";

describe("feed tokens", () => {
  it("round-trips a token through the URL segment, with or without the .ics suffix", () => {
    const token = createBearerToken();
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
