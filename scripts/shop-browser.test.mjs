import { describe, expect, it } from "vitest";
import { authorizedBrowserRequest } from "./shop-browser.ts";

describe("local operator browser boundary", () => {
  const origin = "http://127.0.0.1:14321";
  const headers = {
    host: "127.0.0.1:14321",
    origin,
    authorization: "Bearer private-launch-secret",
  };
  it("requires the private launch secret and exact local origin and host on POST", () => {
    expect(
      authorizedBrowserRequest({ method: "POST", headers }, origin, "private-launch-secret"),
    ).toBe(true);
    for (const overrides of [
      { authorization: undefined },
      { authorization: "Bearer wrong" },
      { origin: "https://attacker.example" },
      { host: "attacker.example:14321" },
      { origin: undefined },
    ]) {
      expect(
        authorizedBrowserRequest(
          { method: "POST", headers: { ...headers, ...overrides } },
          origin,
          "private-launch-secret",
        ),
      ).toBe(false);
    }
    expect(
      authorizedBrowserRequest({ method: "GET", headers }, origin, "private-launch-secret"),
    ).toBe(false);
  });
});
