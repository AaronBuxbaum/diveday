import { describe, expect, it } from "vitest";
import { splitMediaUrls } from "./dive-sites";

describe("splitMediaUrls", () => {
  it("keeps unique, valid HTTP image links in their entered order", () => {
    expect(
      splitMediaUrls(
        " https://images.example/reef.jpg\nhttps://images.example/turtle.jpg\nhttps://images.example/reef.jpg ",
      ),
    ).toEqual(["https://images.example/reef.jpg", "https://images.example/turtle.jpg"]);
  });

  it("rejects non-web links", () => {
    expect(() => splitMediaUrls("ftp://images.example/reef.jpg")).toThrow("HTTP(S)");
  });

  it("limits a briefing to six images", () => {
    expect(() =>
      splitMediaUrls(Array.from({ length: 7 }, (_, i) => `https://images.example/${i}`).join("\n")),
    ).toThrow("six");
  });
});
