import { describe, expect, it } from "vitest";
import { stripSessionSetCookies } from "./session-cookies";

describe("stripSessionSetCookies", () => {
  it("drops a bare session-token cookie", () => {
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

  it("drops chunked session-token cookies (.0, .1, ...)", () => {
    expect(
      stripSessionSetCookies([
        "__Secure-authjs.session-token.0=abc; Path=/",
        "__Secure-authjs.session-token.1=def; Path=/",
      ]),
    ).toEqual([]);
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
