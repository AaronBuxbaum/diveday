import { describe, expect, it } from "vitest";
import { errorCauseTokens, errorClassToken, errorCodeToken, thrownErrorToken } from "./error-token";

/**
 * **A thrown error, reduced to words a log or a column may hold** (issue #2334).
 * A message can quote whatever the failing call was handed: an address, a
 * name, a bound parameter. A class name and a driver's own code cannot, so
 * those are all that come out, and only when they look like one.
 */
describe("errorClassToken", () => {
  it("names the class", () => {
    expect(errorClassToken(new TypeError("nora@example.com"))).toBe("TypeError");
  });

  it("says unknown_error for a throw that is not an Error", () => {
    expect(errorClassToken("nora@example.com")).toBe("unknown_error");
  });

  it("refuses a name that is not an identifier", () => {
    const error = new Error("x");
    error.name = "Error for nora@example.com";
    expect(errorClassToken(error)).toBe("unknown_error");
  });
});

describe("errorCauseTokens", () => {
  it("reads a SQLSTATE and the cause's class off a driver error", () => {
    const cause = Object.assign(new Error("Key (email)=(nora@example.com) exists"), {
      name: "PostgresError",
      code: "23505",
    });
    const error = new Error("Failed query: insert ... params: nora@example.com", { cause });
    expect(errorCauseTokens(error)).toEqual({ causeName: "PostgresError", causeCode: "23505" });
  });

  it("drops a cause code that is not a plain token", () => {
    const error = new Error("x", { cause: { code: "nora@example.com" } });
    expect(errorCauseTokens(error)).toEqual({});
  });

  it("is empty with no cause", () => {
    expect(errorCauseTokens(new Error("x"))).toEqual({});
    expect(errorCauseTokens("x")).toEqual({});
  });
});

describe("thrownErrorToken", () => {
  it("prefers the cause's code, which says what the network did", () => {
    const error = new TypeError("fetch failed for nora@example.com", {
      cause: Object.assign(new Error("connect ECONNRESET 10.0.0.1"), { code: "ECONNRESET" }),
    });
    expect(thrownErrorToken(error)).toBe("ECONNRESET");
  });

  it("falls back to the class", () => {
    expect(thrownErrorToken(new Error("socket hang up for nora@example.com"))).toBe("Error");
  });
});

describe("errorCodeToken", () => {
  it("reads the error's own code first, then its cause's", () => {
    expect(errorCodeToken(Object.assign(new Error("x"), { code: "23505" }))).toBe("23505");
    const cause = Object.assign(new Error("x"), { code: "ECONNRESET" });
    expect(errorCodeToken(new TypeError("x", { cause }))).toBe("ECONNRESET");
  });

  it("is undefined when no code has the shape of one", () => {
    expect(
      errorCodeToken(Object.assign(new Error("x"), { code: "nora@example.com" })),
    ).toBeUndefined();
    expect(errorCodeToken(new Error("x"))).toBeUndefined();
    expect(errorCodeToken("x")).toBeUndefined();
  });
});
