import { describe, expect, it } from "vitest";
import { isUuid, UUID_SOURCE, uuidParam } from "./uuid";

const V4 = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const V7 = "018f4e6a-7b2c-7d3e-8f4a-1b2c3d4e5f60";
const NIL = "00000000-0000-0000-0000-000000000000";

describe("isUuid", () => {
  it("accepts a Postgres gen_random_uuid() value", () => {
    expect(isUuid(V4)).toBe(true);
  });

  it("is version-agnostic: a v7 or nil id is still looked up, and simply matches no row", () => {
    expect(isUuid(V7)).toBe(true);
    expect(isUuid(NIL)).toBe(true);
  });

  it("accepts upper-case hex, which is how some clients paste an id", () => {
    expect(isUuid(V4.toUpperCase())).toBe(true);
  });

  it("refuses 36 characters that are not a uuid", () => {
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c330g")).toBe(false);
    expect(isUuid("3f2504e04f8941d39a0c0305e82c3301")).toBe(false);
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c330")).toBe(false);
    expect(isUuid(`${V4}1`)).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  it("is anchored: a uuid embedded in a longer string is not a uuid", () => {
    expect(isUuid(` ${V4}`)).toBe(false);
    expect(isUuid(`${V4}\n`)).toBe(false);
    expect(isUuid(`'; drop table orders; -- ${V4}`)).toBe(false);
  });
});

describe("uuidParam", () => {
  it("hands back a well-formed id untouched", () => {
    expect(uuidParam(V4)).toBe(V4);
  });

  it("reads a missing or malformed URL value as no filter, never a 500", () => {
    expect(uuidParam(undefined)).toBeUndefined();
    expect(uuidParam(null)).toBeUndefined();
    expect(uuidParam("")).toBeUndefined();
    expect(uuidParam("3f2504e0-4f89-41d3")).toBeUndefined();
    expect(uuidParam("not-an-id")).toBeUndefined();
  });
});

describe("UUID_SOURCE", () => {
  it("composes into a larger pattern without anchors of its own", () => {
    expect(UUID_SOURCE).not.toMatch(/[\^$]/);
    const inPath = new RegExp(`^/orders/(${UUID_SOURCE})$`, "i");
    expect(inPath.exec(`/orders/${V4}`)?.[1]).toBe(V4);
    expect(inPath.test("/orders/latest")).toBe(false);
  });
});
