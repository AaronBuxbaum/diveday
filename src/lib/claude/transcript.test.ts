import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { base64Bytes, formatBytes, plausibleRequestId, renderContent } from "./transcript";

/** A base64 payload of `bytes` bytes whose every character is a recognisable marker. */
function payload(bytes: number): string {
  return "QUJD".repeat(Math.ceil(bytes / 3)).slice(0, Math.ceil((bytes * 4) / 3));
}

const LARGE = payload(812_000);

function image(data: string, mediaType = "image/jpeg"): Anthropic.ContentBlockParam {
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data } as Anthropic.Base64ImageSource,
  };
}

describe("renderContent", () => {
  it("passes plain text through", () => {
    expect(renderContent("Is there space Saturday?")).toBe("Is there space Saturday?");
  });

  it("turns a large image into a placeholder and keeps none of its bytes", () => {
    const rendered = renderContent([image(LARGE)]);
    expect(rendered).toBe("[image: image/jpeg, 812 KB, not kept]");
    expect(rendered).not.toContain("QUJD");
  });

  it("turns a PDF into a placeholder", () => {
    const pdf: Anthropic.ContentBlockParam = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: payload(1_234_567) },
    };
    const rendered = renderContent([pdf]);
    expect(rendered).toBe("[document: application/pdf, 1.2 MB, not kept]");
    expect(rendered).not.toContain("QUJD");
  });

  it("keeps the words of a mixed array and none of the media", () => {
    const blocks: Anthropic.ContentBlockParam[] = [
      { type: "text", text: "Read this card." },
      image(LARGE, "image/png"),
      { type: "image", source: { type: "url", url: "https://cdn.example/secret.jpg?token=abc" } },
      { type: "document", source: { type: "text", media_type: "text/plain", data: "Ana Diaz" } },
      { type: "document", source: { type: "url", url: "https://cdn.example/waiver.pdf?sig=xyz" } },
      { type: "document", source: { type: "file", file_id: "file_123" } },
      {
        type: "document",
        source: { type: "content", content: [image(LARGE) as Anthropic.ImageBlockParam] },
      },
      { type: "text", text: "Only the number." },
    ];
    const rendered = renderContent(blocks);
    expect(rendered).toBe(
      [
        "Read this card.",
        "[image: image/png, 812 KB, not kept]",
        "[image: image, from a link, not kept]",
        "[document: text/plain, 8 B, not kept]",
        "[document: document, from a link, not kept]",
        "[document: document, from a stored file, not kept]",
        "[document: document, as blocks, not kept]",
        "Only the number.",
      ].join("\n\n"),
    );
    for (const leak of ["QUJD", "secret.jpg", "token=abc", "Ana Diaz", "sig=xyz", "file_123"]) {
      expect(rendered).not.toContain(leak);
    }
  });

  it("never prints a block it does not know, or a media type it cannot trust", () => {
    const blocks = [
      { type: "tool_result", tool_use_id: "toolu_1", content: [image(LARGE)] },
      image(LARGE, `image/jpeg ${LARGE}`),
    ] as Anthropic.ContentBlockParam[];
    const rendered = renderContent(blocks);
    expect(rendered).toBe("[tool_result block, not kept]\n\n[image: unknown, 812 KB, not kept]");
    expect(rendered).not.toContain("QUJD");
  });
});

describe("the byte counts", () => {
  it("reads a base64 length as the bytes it decodes to", () => {
    expect(base64Bytes("")).toBe(0);
    expect(base64Bytes("QQ==")).toBe(1);
    expect(base64Bytes("QUI=")).toBe(2);
    expect(base64Bytes("QUJD")).toBe(3);
  });

  it("writes a size the way a person reads one", () => {
    expect(formatBytes(300)).toBe("300 B");
    expect(formatBytes(812_000)).toBe("812 KB");
    expect(formatBytes(1_234_567)).toBe("1.2 MB");
  });
});

describe("plausibleRequestId", () => {
  it("keeps an id and refuses anything else", () => {
    expect(plausibleRequestId("req_011CTabc-9")).toBe("req_011CTabc-9");
    expect(plausibleRequestId("two words")).toBeNull();
    expect(plausibleRequestId("x".repeat(129))).toBeNull();
    expect(plausibleRequestId(42)).toBeNull();
    expect(plausibleRequestId(null)).toBeNull();
  });
});
