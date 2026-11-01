import { describe, expect, it } from "vitest";
import { messageFallback } from "./message-fallback";

describe("messageFallback", () => {
  const messages = { common: { title: "English title", count: 3, nested: null } };

  it("returns a string leaf from the supplied bundle", () => {
    expect(messageFallback(messages, "common.title")).toBe("English title");
  });

  it.each(["common.missing", "common.count", "common.nested.title", "missing.title", ""])(
    "returns the original key when %s does not resolve to a string",
    (key) => expect(messageFallback(messages, key)).toBe(key),
  );

  it("does not resolve inherited object properties", () => {
    expect(messageFallback({}, "constructor.name")).toBe("constructor.name");
  });
});
