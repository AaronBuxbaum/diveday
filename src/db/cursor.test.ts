import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

describe("encodeCursor / decodeCursor", () => {
  const ID = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607";

  it("round-trips a sort value and id", () => {
    const cursor = encodeCursor("2026-07-24T00:00:00.000Z", ID);
    expect(decodeCursor(cursor)).toEqual(["2026-07-24T00:00:00.000Z", ID]);
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

  it("rejects a well-formed pair whose id is not a uuid", () => {
    // The id half lands in `gt(trips.id, …)` against a `uuid` column, so a
    // hand-crafted cursor of the right *shape* carrying "nope" is not an empty
    // page — it is `invalid input syntax for type uuid` and a 500. The public
    // schedule takes `?after=` from anyone at all, so this one has no session
    // in front of it.
    const badId = Buffer.from(
      JSON.stringify(["2026-07-24T00:00:00.000Z", "nope"]),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(badId)).toBeNull();
  });

  it("rejects a decoded object instead of an array", () => {
    const notArray = Buffer.from(JSON.stringify({ sortValue: "a", id: "b" }), "utf8").toString(
      "base64url",
    );
    expect(decodeCursor(notArray)).toBeNull();
  });
});
