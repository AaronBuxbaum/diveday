import { describe, expect, it } from "vitest";
import { deriveLabelKey, signPayload, tagMatches } from "./signed-token";

const SECRET = "known-answer-secret";

describe("primitives, known answers", () => {
  it("derives the same 32-byte key for a label as HKDF-SHA256 with an empty salt always did", () => {
    expect(deriveLabelKey(SECRET, "diveday-recap-link").toString("hex")).toBe(
      "7f911d3be54e2954a44902b5e07d96122a5ad8a9ef17b4073c0e0c5ac82103b4",
    );
    expect(deriveLabelKey(SECRET, "diveday-demo-seat").toString("hex")).toBe(
      "8da4a9a36d1388d309172709acb3e7d05dd289f15cc212784a9776bf72ab4529",
    );
  });

  it("signs with a Buffer key and with its base64url string as two different keys", () => {
    const key = deriveLabelKey(SECRET, "diveday-recap-link");
    expect(signPayload(key, "hello")).toBe("8q6ZPfK1HEX8Ss-3T4z1FTM0fID6FmsAWVRIoHkZPqg");
    expect(signPayload(key.toString("base64url"), "hello")).toBe(
      "WazSzGvVn6bQLt7j8vZfgvN319txbzU53fTG6V2_2VU",
    );
  });
});

describe("tagMatches, lazy expected tag", () => {
  it("refuses a malformed tag without computing the expected one", () => {
    const boom = () => {
      throw new Error("no secret");
    };
    expect(tagMatches("not base64url!", boom)).toBe(false);
    expect(tagMatches("é", boom)).toBe(false);
    expect(tagMatches("", boom)).toBe(false);
  });
});

describe("tagMatches", () => {
  const key = deriveLabelKey(SECRET, "diveday-recap-link");
  const tag = signPayload(key, "payload");

  it("accepts the tag over the payload it signed", () => {
    expect(tagMatches(tag, signPayload(key, "payload"))).toBe(true);
  });

  it.each([
    ["truncated", tag.slice(0, -1)],
    ["over-long", `${tag}A`],
    ["empty", ""],
    ["a single character", "A"],
    ["multibyte characters of the same character length", `${tag.slice(0, 42)}é`],
    ["an emoji of the same UTF-16 length", `${tag.slice(0, 41)}😀`],
    ["CJK glyphs of the same character length", "漢".repeat(tag.length)],
    ["non-base64url characters", `${tag.slice(0, 40)}+/=`],
    ["padding", `${tag.slice(0, 42)}=`],
    ["whitespace", ` ${tag.slice(1)}`],
    ["a NUL byte", `${tag.slice(0, 42)}\0`],
  ])("answers false, never throws, for a %s tag", (_, supplied) => {
    expect(() => tagMatches(supplied, tag)).not.toThrow();
    expect(tagMatches(supplied, tag)).toBe(false);
  });

  it.each([undefined, null, 42, {}, [tag], Buffer.from(tag)])(
    "answers false for a non-string %#",
    (supplied) => {
      expect(tagMatches(supplied, tag)).toBe(false);
    },
  );

  it("answers false when both sides are empty", () => {
    expect(tagMatches("", "")).toBe(false);
  });

  it("rejects a tag minted under another purpose label", () => {
    const other = signPayload(deriveLabelKey(SECRET, "diveday-buddy-link"), "payload");
    expect(other).not.toBe(tag);
    expect(tagMatches(other, tag)).toBe(false);
  });

  it("rejects a tag over a different payload", () => {
    expect(tagMatches(signPayload(key, "payload2"), tag)).toBe(false);
  });

  it("rejects a tag minted under another secret", () => {
    expect(
      tagMatches(signPayload(deriveLabelKey("other", "diveday-recap-link"), "payload"), tag),
    ).toBe(false);
  });
});
