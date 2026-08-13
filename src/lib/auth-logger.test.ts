import { afterEach, describe, expect, it, vi } from "vitest";
import { isCredentialsRefusal, logAuthError } from "./auth-logger";

/**
 * The structured lines `log()` wrote. A `warn` goes to `console.warn` (see
 * `src/lib/log.ts`), so both sinks are captured — asserting on the wrong one
 * would let a level regression pass unnoticed.
 */
function captureLines(run: () => void): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  const collect = (line: string) => {
    lines.push(JSON.parse(line));
  };
  const spies = [
    vi.spyOn(console, "log").mockImplementation(collect),
    vi.spyOn(console, "warn").mockImplementation(collect),
  ];
  try {
    run();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return lines;
}

/** An Auth.js `CredentialsSignin`, which carries the identifier it refused. */
function credentialsSignin(): Error {
  return Object.assign(new Error("Invalid credentials for diver@example.com"), {
    name: "CredentialsSignin",
    type: "CredentialsSignin",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isCredentialsRefusal", () => {
  it("recognises the refused-password error", () => {
    expect(isCredentialsRefusal(credentialsSignin())).toBe(true);
  });

  it("does not claim anything else", () => {
    expect(isCredentialsRefusal(new Error("boom"))).toBe(false);
    expect(
      isCredentialsRefusal(Object.assign(new Error("x"), { type: "OAuthCallbackError" })),
    ).toBe(false);
    // Handed something that is not an error at all, it must fall through to
    // being reported rather than swallowed.
    expect(isCredentialsRefusal(null)).toBe(false);
    expect(isCredentialsRefusal("CredentialsSignin")).toBe(false);
  });
});

describe("logAuthError", () => {
  it("writes a refused password as one counted warn line", () => {
    const unexpected = vi.fn();
    const lines = captureLines(() => {
      logAuthError(credentialsSignin(), unexpected);
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual(
      expect.objectContaining({ event: "auth.sign_in_refused", level: "warn" }),
    );
    expect(unexpected).not.toHaveBeenCalled();
  });

  /**
   * The rule this exists to keep: a credentials error quotes the identifier it
   * refused, and none of it may reach the log stream. The refusal is counted,
   * never attributed.
   */
  it("carries no address, no message, and no stack", () => {
    const lines = captureLines(() => {
      logAuthError(credentialsSignin(), vi.fn());
    });
    const written = JSON.stringify(lines[0]);
    expect(written).not.toContain("diver@example.com");
    expect(written).not.toContain("Invalid credentials");
    expect(written).not.toContain("stack");
  });

  it("still reports every other auth error, unchanged", () => {
    const unexpected = vi.fn();
    const failure = Object.assign(new Error("state cookie was missing"), {
      type: "OAuthCallbackError",
    });
    const lines = captureLines(() => {
      logAuthError(failure, unexpected);
    });
    // Nothing structured swallowed it, and the sink saw the real error.
    expect(lines).toHaveLength(0);
    expect(unexpected).toHaveBeenCalledWith("[auth][error]", failure);
  });
});
