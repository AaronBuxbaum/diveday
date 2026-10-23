import { describe, expect, it } from "vitest";
import { isCrossSiteRequest } from "./same-origin";

const at = (headers: Record<string, string>) =>
  new Request("https://diveday.test/api/x", { method: "POST", headers });

describe("isCrossSiteRequest (security review 2, L5)", () => {
  it("lets the app's own requests through, and a request with no Origin to the session check", () => {
    expect(isCrossSiteRequest(at({ Origin: "https://diveday.test" }))).toBe(false);
    expect(isCrossSiteRequest(at({ "Sec-Fetch-Site": "same-origin" }))).toBe(false);
    expect(isCrossSiteRequest(at({}))).toBe(false);
  });

  it("refuses another origin, the opaque null origin, and a cross-site fetch", () => {
    expect(isCrossSiteRequest(at({ Origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteRequest(at({ Origin: "http://diveday.test" }))).toBe(true);
    expect(isCrossSiteRequest(at({ Origin: "null" }))).toBe(true);
    expect(isCrossSiteRequest(at({ "Sec-Fetch-Site": "cross-site" }))).toBe(true);
  });
});
