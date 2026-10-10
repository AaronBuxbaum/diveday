import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

describe("encodeCursor / decodeCursor", () => {
  const ID = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607";

  it("round-trips a sort value, a tiebreak and an id", () => {
    const cursor = encodeCursor("2026-07-24T00:00:00.000Z", "Wreck Trek", ID);
    expect(decodeCursor(cursor)).toEqual(["2026-07-24T00:00:00.000Z", "Wreck Trek", ID]);
  });

  it("round-trips a tiebreak that is empty or carries quotes and accents", () => {
    for (const tiebreak of ["", 'The "Duane" — día'])
      expect(decodeCursor(encodeCursor("2026-07-24T00:00:00.000Z", tiebreak, ID))).toEqual([
        "2026-07-24T00:00:00.000Z",
        tiebreak,
        ID,
      ]);
  });

  it("treats a pair from before the tiebreak as page one (issue #2175)", () => {
    // A link saved while the cursor was (start, id) has no title to resume
    // after; restarting the list is the honest answer.
    const pair = Buffer.from(JSON.stringify(["2026-07-24T00:00:00.000Z", ID]), "utf8").toString(
      "base64url",
    );
    expect(decodeCursor(pair)).toBeNull();
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

  it("rejects a decoded triple with a non-string element", () => {
    const wrongTypes = Buffer.from(
      JSON.stringify(["2026-07-24T00:00:00.000Z", 2, ID]),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(wrongTypes)).toBeNull();
  });

  it("rejects a well-formed triple whose id is not a uuid", () => {
    // The id half lands in `gt(trips.id, …)` against a `uuid` column, so a
    // hand-crafted cursor of the right *shape* carrying "nope" is not an empty
    // page — it is `invalid input syntax for type uuid` and a 500. The public
    // schedule takes `?after=` from anyone at all, so this one has no session
    // in front of it.
    const badId = Buffer.from(
      JSON.stringify(["2026-07-24T00:00:00.000Z", "Wreck Trek", "nope"]),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(badId)).toBeNull();
  });

  it("treats a title carrying a NUL or control character as page one (security review)", () => {
    for (const title of ["Wreck\u0000Trek", "Wreck\u0007Trek", "Wreck\nTrek"]) {
      const cursor = Buffer.from(JSON.stringify(["2026-07-24T00:00:00.000Z", title, ID])).toString(
        "base64url",
      );
      expect(decodeCursor(cursor)).toBeNull();
    }
  });

  it("treats a title past 500 characters as page one", () => {
    const at = (title: string) =>
      Buffer.from(JSON.stringify(["2026-07-24T00:00:00.000Z", title, ID])).toString("base64url");
    expect(decodeCursor(at("a".repeat(500)))).not.toBeNull();
    expect(decodeCursor(at("a".repeat(501)))).toBeNull();
  });

  it("treats a start that is not a date in 1970–9999 as page one", () => {
    for (const start of ["+275760-09-13T00:00:00.000Z", "1969-12-31T23:59:59.000Z", "nope", ""]) {
      const cursor = Buffer.from(JSON.stringify([start, "Wreck Trek", ID])).toString("base64url");
      expect(decodeCursor(cursor)).toBeNull();
    }
    const ok = Buffer.from(JSON.stringify(["9999-12-31T00:00:00.000Z", "Wreck Trek", ID])).toString(
      "base64url",
    );
    expect(decodeCursor(ok)).not.toBeNull();
  });

  it("rejects a decoded object instead of an array", () => {
    const notArray = Buffer.from(JSON.stringify({ sortValue: "a", id: "b" }), "utf8").toString(
      "base64url",
    );
    expect(decodeCursor(notArray)).toBeNull();
  });
});
