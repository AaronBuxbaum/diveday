import { describe, expect, it } from "vitest";
import {
  createPendingHandle,
  hashPendingHandle,
  pendingCookie,
  readPendingHandle,
  signInOrigins,
  trustedSignInOrigin,
} from "./pending-sign-in";

describe("pending sign-in policy", () => {
  it("binds local transport exceptions to the server-configured port and isolated runtime", () => {
    expect(
      signInOrigins("https://e2e.diveday.example", {
        NODE_ENV: "production",
        DIVEDAY_E2E: "1",
        PORT: "4123",
      }),
    ).toEqual(["http://127.0.0.1:4123"]);
    expect(signInOrigins("https://dive.day", { NODE_ENV: "production", PORT: "4123" })).toEqual([
      "https://dive.day",
    ]);
    expect(
      signInOrigins("https://dive.day", {
        NODE_ENV: "production",
        DIVEDAY_E2E: "1",
        DATABASE_URL: "configured",
        PORT: "4123",
      }),
    ).toEqual(["https://dive.day"]);
    const origins = signInOrigins("http://localhost:3000", {
      NODE_ENV: "development",
      PORT: "3000",
    });
    expect(
      trustedSignInOrigin(new Headers({ origin: "http://localhost:3000" }), true, origins),
    ).toBe(true);
    expect(
      trustedSignInOrigin(new Headers({ origin: "http://localhost:3001" }), true, origins),
    ).toBe(false);
    expect(
      trustedSignInOrigin(
        new Headers({ origin: "http://evil.example:3000", host: "localhost:3000" }),
        true,
        origins,
      ),
    ).toBe(false);
  });
  it("mints an unpredictable handle and stores only its digest", () => {
    const handle = createPendingHandle();
    expect(handle).toMatch(/^[\w-]{43}$/);
    expect(createPendingHandle()).not.toBe(handle);
    expect(hashPendingHandle(handle)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPendingHandle(handle)).not.toBe(handle);
  });
  it("uses a strict host cookie, with a distinct insecure loopback test name", () => {
    expect(pendingCookie("https://dive.day", false)).toMatchObject({
      name: "__Host-diveday.pending_sign_in",
      attributes: { secure: true, httpOnly: true, sameSite: "strict", path: "/", maxAge: 300 },
    });
    expect(pendingCookie("http://localhost:3000", true)).toMatchObject({
      name: "diveday.pending_sign_in",
      attributes: { secure: false },
    });
    expect(pendingCookie("https://dive.day", true).attributes.secure).toBe(true);
  });
  it("refuses malformed and duplicated cookies", () => {
    const cookie = pendingCookie("https://dive.day", false);
    const handle = createPendingHandle();
    expect(
      readPendingHandle(new Headers({ cookie: `${cookie.name}=${handle}` }), cookie.name),
    ).toBe(handle);
    expect(
      readPendingHandle(
        new Headers({ cookie: `${cookie.name}=${handle}; ${cookie.name}=${handle}` }),
        cookie.name,
      ),
    ).toBeNull();
    expect(
      readPendingHandle(new Headers({ cookie: `${cookie.name}=chosen` }), cookie.name),
    ).toBeNull();
  });
  it("accepts only the configured origin or an explicit in-process server call", () => {
    expect(
      trustedSignInOrigin(
        new Headers({ origin: "https://dive.day" }),
        true,
        "https://dive.day/api/auth",
      ),
    ).toBe(true);
    expect(
      trustedSignInOrigin(
        new Headers({ origin: "https://evil.example", host: "evil.example" }),
        false,
        "https://dive.day",
      ),
    ).toBe(false);
    expect(trustedSignInOrigin(new Headers(), true, "https://dive.day")).toBe(false);
    expect(trustedSignInOrigin(new Headers(), false, "https://dive.day")).toBe(true);
    expect(
      trustedSignInOrigin(
        new Headers({ "sec-fetch-site": "cross-site" }),
        false,
        "https://dive.day",
      ),
    ).toBe(false);
  });
});
