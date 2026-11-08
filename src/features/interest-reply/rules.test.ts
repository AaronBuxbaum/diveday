import { describe, expect, it } from "vitest";
import { interestReplySubject, interestReplyText } from "../../lib/notifications/index";
import { messageFor } from "../../lib/notifications/render";
import {
  foldInterestReplyForText,
  INTEREST_REPLY_MAX,
  interestReplyProblem,
  interestReplyRoute,
  normalizeInterestReply,
} from "./rules";

describe("interestReplyRoute", () => {
  it("takes the email when there is one, whatever the phone says", () => {
    expect(
      interestReplyRoute({ email: " priya@example.com ", phone: "+13055550134" }, "US"),
    ).toEqual({ channel: "email", to: "priya@example.com" });
  });

  it("texts a number that reads as a phone, against the shop's own country", () => {
    expect(interestReplyRoute({ email: null, phone: "305-555-0134" }, "US")).toEqual({
      channel: "text",
      to: "+13055550134",
    });
    expect(interestReplyRoute({ email: "  ", phone: "+34 612 345 678" }, null)).toEqual({
      channel: "text",
      to: "+34612345678",
    });
  });

  it("offers nothing for a number it would have to guess", () => {
    expect(interestReplyRoute({ email: null, phone: "612345678" }, null)).toBeNull();
    expect(interestReplyRoute({ email: null, phone: "ask for Sam" }, "US")).toBeNull();
    expect(interestReplyRoute({ email: null, phone: null }, "US")).toBeNull();
  });
});

describe("interestReplyProblem", () => {
  it("refuses blank and over-long words, and counts after trimming", () => {
    expect(interestReplyProblem(" \r\n ")).toBe("empty");
    expect(interestReplyProblem("x".repeat(INTEREST_REPLY_MAX + 1))).toBe("too_long");
    expect(interestReplyProblem(`  ${"x".repeat(INTEREST_REPLY_MAX)}  `)).toBeNull();
  });

  it("keeps paragraphs for email and folds them for a text", () => {
    expect(normalizeInterestReply(" a\r\n\r\nb ")).toBe("a\n\nb");
    expect(foldInterestReplyForText("a\n\n  b\tc")).toBe("a b c");
  });
});

describe("the reply as the diver gets it", () => {
  it("escapes the staffer's words in the email's html, and keeps them whole in its text", () => {
    const body = `<script>alert("x")</script> & <a href="https://evil.example">here</a>`;
    const email = messageFor({
      kind: "staff_reply",
      replyId: "00000000-0000-4000-8000-000000000001",
      shopId: "00000000-0000-4000-8000-000000000002",
      to: "priya@example.com",
      locale: "en-US",
      shopName: "Blue Mantis",
      subject: interestReplySubject("en-US", "Blue Mantis"),
      body,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<a href");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.text).toContain(body);
  });

  it("answers the acknowledgment the diver already has", () => {
    expect(interestReplySubject("en-US", "Blue Mantis")).toBe("Re: Blue Mantis has your request");
  });

  it("names the shop first in a text", () => {
    expect(interestReplyText("es-ES", "Blue Mantis", "Nos vemos.")).toBe("Blue Mantis: Nos vemos.");
  });
});
