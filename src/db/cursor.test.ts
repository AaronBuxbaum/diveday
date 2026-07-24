import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a sort value and id", () => {
    const cursor = encodeCursor("2026-07-24T00:00:00.000Z", "abc-123");
    expect(decodeCursor(cursor)).toEqual(["2026-07-24T00:00:00.000Z", "abc-123"]);
  });

  it("treats an undefined cursor as page one", () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("treats an empty-string cursor as page one", () => {
    expect(decodeCursor("")).toBeNull();
  });

  it("treats unparsable base64url garbage as page one", () => {
    expect(decodeCursor("not-a-real-cursor")).toBeNull();
  });

  it("treats valid base64url that decodes to non-JSON as page one", () => {
    const notJson = Buffer.from("this is not json", "utf8").toString("base64url");
    expect(decodeCursor(notJson)).toBeNull();
  });

  it("rejects a decoded array of the wrong length", () => {
    const wrongShape = Buffer.from(JSON.stringify(["only-one"]), "utf8").toString("base64url");
    expect(decodeCursor(wrongShape)).toBeNull();
  });

  it("rejects a decoded pair with non-string elements", () => {
    const wrongTypes = Buffer.from(JSON.stringify([1, 2]), "utf8").toString("base64url");
    expect(decodeCursor(wrongTypes)).toBeNull();
  });

  it("rejects a decoded object instead of an array", () => {
    const notArray = Buffer.from(JSON.stringify({ sortValue: "a", id: "b" }), "utf8").toString(
      "base64url",
    );
    expect(decodeCursor(notArray)).toBeNull();
  });
});
