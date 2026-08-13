import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logAuthError } from "./auth-logger";

/**
 * The point of this module is a *level*, so every assertion here is about which
 * console stream a given Auth.js error lands on. A regression would not throw;
 * it would quietly put wrong passwords back into `level:error` and make the
 * query an operator runs during an incident useless again (issue #517).
 *
 * Errors are built by hand rather than imported from `next-auth`: its entry
 * point reaches for `next/server`, which does not resolve in this environment.
 * What is reproduced is the shape `@auth/core` actually throws — `name` is the
 * class name, `type` is the static, and the constructor appends the
 * `errors.authjs.dev` link to the message.
 */
function authError(type: string, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`${message}. Read more at https://errors.authjs.dev#${type}`), {
    name: type,
    type,
    ...extra,
  });
}

/** What `@auth/core` throws when the credentials `authorize` callback returns null. */
function credentialsSignin(): Error {
  return authError("CredentialsSignin", "", { code: "credentials" });
}

describe("logAuthError", () => {
  beforeEach(() => {
    vi.stubEnv("DIVEDAY_CLOCK", "2026-08-13T12:00:00.000Z");
    // `log()` buffers for CloudWatch; with no credentials that is already a
    // no-op, and this keeps the test from depending on which.
    vi.stubEnv("DATABASE_URL", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("writes a refused credential as one warn line and nothing at error level", () => {
    logAuthError(credentialsSignin());

    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    const line = vi.mocked(console.warn).mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      time: "2026-08-13T12:00:00.000Z",
      level: "warn",
      event: "auth.sign_in_refused",
      code: "credentials",
    });
  });

  it("carries no address, password, or IP on the refusal line", () => {
    const error = credentialsSignin();
    // What a caller would have had in hand at the moment of the refusal. None
    // of it may reach the line: this path is reachable by anyone on the
    // internet, so the log would fill with attempted addresses.
    error.cause = { err: new Error("no person for owner@blue-mantis.test from 203.0.113.7") };

    logAuthError(error);

    const line = vi.mocked(console.warn).mock.calls[0]?.[0] as string;
    expect(line).not.toContain("owner@blue-mantis.test");
    expect(line).not.toContain("203.0.113.7");
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(["code", "event", "level", "time"]);
  });

  it("recognises a refusal by its type, not by class identity", () => {
    // A second physical copy of `@auth/core` in the dependency graph would make
    // `instanceof` false for a genuinely refused credential and put the noisy
    // line straight back with nothing failing. The downgrade keys on the
    // `type` string, which survives that.
    logAuthError(credentialsSignin());

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("writes every other Auth.js error as a structured error line", () => {
    // Same level and same stream as before, but JSON — so it is queryable and
    // counted by the `AppErrors` filter (`$.level = "error"`), which the ANSI
    // line it replaces never was.
    logAuthError(authError("MissingSecret", "Please define a `secret`"));

    expect(console.warn).not.toHaveBeenCalled();
    const line = vi.mocked(console.error).mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      time: "2026-08-13T12:00:00.000Z",
      level: "error",
      event: "auth.error",
      type: "MissingSecret",
      message: "Please define a `secret`. Read more at https://errors.authjs.dev#MissingSecret",
      cause: null,
    });
  });

  it("names a wrapped cause by its class and never ships its text", () => {
    // `CallbackRouteError` and friends wrap whatever our own code threw, and a
    // driver's message can echo the value that caused it. The class is enough
    // to triage on; the message is not ours to send anywhere.
    const error = authError("CallbackRouteError", "Read more");
    error.cause = { err: new TypeError('relation "people" does not exist'), provider: "creds" };

    logAuthError(error);

    const line = vi.mocked(console.error).mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toMatchObject({ type: "CallbackRouteError", cause: "TypeError" });
    expect(line).not.toContain("people");
  });

  it("still prints the cause and details to the console for a developer", () => {
    // The structured line is for the log drain; this is what someone reading
    // Vercel's own view needs, and losing it would make the change a debugging
    // regression.
    const error = authError("CallbackRouteError", "Read more");
    error.cause = { err: new Error('relation "people" does not exist'), provider: "creds" };

    logAuthError(error);

    const written = vi.mocked(console.error).mock.calls.slice(1).flat().join("\n");
    expect(written).toContain("[auth][cause]");
    expect(written).toContain('relation "people" does not exist');
    expect(written).toContain("creds");
  });

  it("leaves a plain thrown Error at error level too", () => {
    logAuthError(new TypeError("fetch failed"));

    expect(console.warn).not.toHaveBeenCalled();
    const line = vi.mocked(console.error).mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toMatchObject({ type: "TypeError", message: "fetch failed" });
  });
});
