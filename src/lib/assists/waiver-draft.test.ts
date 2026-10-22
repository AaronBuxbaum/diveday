import { describe, expect, it } from "vitest";
import { buildStructuredRequest, callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { reservedMicroUsd } from "@/db/assists";
import { looksLikePdf, pdfInputTokens, waiverDraftBody, waiverDraftCall } from "./waiver-draft";

const RELEASE =
  "Release of Liability\n\nI understand that scuba diving carries risks.\n\n\n\nI agree.";

describe("waiverDraftCall", () => {
  it("sends the PDF as a document block on the draft model", () => {
    const request = buildStructuredRequest(waiverDraftCall("JVBERi0xLjQ="));
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.messages[0]?.content).toEqual([
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQ=" },
      },
      { type: "text", text: "Lay out this release as plain text." },
    ]);
  });

  it("drops an answer read with low confidence", async () => {
    const provider = fakeClaude({
      reply: () =>
        fakeClaudeMessage({
          text: JSON.stringify({ body: RELEASE, notAWaiver: false, confidence: 0.3 }),
        }),
    });
    expect((await callStructured(provider, waiverDraftCall("x"))).value).toBeNull();
  });
});

describe("the reservation for a PDF", () => {
  it("grows with the file, so a long release is held against the cap before it is sent", () => {
    const small = Buffer.from("%PDF-1.7 short").toString("base64");
    const large = Buffer.alloc(5 * 1024 * 1024, 65).toString("base64");
    expect(pdfInputTokens(small)).toBe(20_000);
    expect(pdfInputTokens(large)).toBe(300_000);
    expect(reservedMicroUsd(waiverDraftCall(large))).toBeGreaterThan(
      reservedMicroUsd(waiverDraftCall(small)) * 5,
    );
    // The hint is the cap's, never part of the request.
    expect(JSON.stringify(buildStructuredRequest(waiverDraftCall(small)))).not.toContain(
      "inputTokens",
    );
  });
});

describe("waiverDraftBody", () => {
  it("tidies blank lines and keeps the wording", () => {
    expect(waiverDraftBody({ body: RELEASE, notAWaiver: false, confidence: 1 })).toBe(
      "Release of Liability\n\nI understand that scuba diving carries risks.\n\nI agree.",
    );
  });

  it("is null for a document that is not a waiver, or a length the editor refuses", () => {
    expect(waiverDraftBody({ body: RELEASE, notAWaiver: true, confidence: 1 })).toBeNull();
    expect(waiverDraftBody({ body: "Too short.", notAWaiver: false, confidence: 1 })).toBeNull();
    expect(
      waiverDraftBody({ body: "x".repeat(12_001), notAWaiver: false, confidence: 1 }),
    ).toBeNull();
  });
});

describe("looksLikePdf", () => {
  it("reads the header, not the name", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html>"))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});
