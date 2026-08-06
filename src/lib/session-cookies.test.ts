import { describe, expect, it } from "vitest";
import { stripSessionSetCookies } from "./session-cookies";

describe("stripSessionSetCookies", () => {
  it("drops a bare session-token refresh cookie", () => {
    expect(stripSessionSetCookies(["authjs.session-token=abc; Path=/; HttpOnly"])).toEqual([]);
  });

  it("drops the __Secure- prefixed variant used in production", () => {
    expect(stripSessionSetCookies(["__Secure-authjs.session-token=abc; Path=/; Secure"])).toEqual(
      [],
    );
  });

  it("drops the __Host- prefixed variant", () => {
    expect(stripSessionSetCookies(["__Host-authjs.session-token=abc; Path=/; Secure"])).toEqual([]);
  });

  it("drops chunked session-token refresh cookies (.0, .1, ...)", () => {
    expect(
      stripSessionSetCookies([
        "__Secure-authjs.session-token.0=abc; Path=/",
        "__Secure-authjs.session-token.1=def; Path=/",
      ]),
    ).toEqual([]);
  });

  it("keeps a session-token clearing cookie (empty value) issued after a decode failure", () => {
    const clear = [
      "__Secure-authjs.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0",
    ];
    expect(stripSessionSetCookies(clear)).toEqual(clear);
  });

  it("keeps a bare clearing cookie and drops a refresh cookie in the same list", () => {
    const input = [
      "authjs.session-token=; Path=/; Max-Age=0",
      "__Secure-authjs.session-token=abc; Path=/; Secure",
    ];
    expect(stripSessionSetCookies(input)).toEqual(["authjs.session-token=; Path=/; Max-Age=0"]);
  });

  it("keeps clearing cookies for every chunk suffix", () => {
    const clear = [
      "__Secure-authjs.session-token.0=; Path=/; Max-Age=0",
      "__Secure-authjs.session-token.1=; Path=/; Max-Age=0",
    ];
    expect(stripSessionSetCookies(clear)).toEqual(clear);
  });

  it("keeps csrf and callback cookies untouched", () => {
    const kept = ["authjs.csrf-token=xyz; Path=/; HttpOnly", "authjs.callback-url=%2Fshop; Path=/"];
    expect(stripSessionSetCookies(kept)).toEqual(kept);
  });

  it("keeps unrelated cookies that merely contain the session-token substring later in the name", () => {
    expect(stripSessionSetCookies(["not-authjs.session-token=abc; Path=/"])).toEqual([
      "not-authjs.session-token=abc; Path=/",
    ]);
  });

  it("strips only the session cookie out of a mixed list, preserving the rest in order", () => {
    const input = [
      "authjs.csrf-token=xyz; Path=/",
      "__Secure-authjs.session-token=abc; Path=/; Secure",
      "authjs.callback-url=%2Fshop; Path=/",
    ];
    expect(stripSessionSetCookies(input)).toEqual([
      "authjs.csrf-token=xyz; Path=/",
      "authjs.callback-url=%2Fshop; Path=/",
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(stripSessionSetCookies([])).toEqual([]);
  });
});
