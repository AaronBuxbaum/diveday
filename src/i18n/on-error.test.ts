import { afterEach, describe, expect, it, vi } from "vitest";
import { translatorOnError } from "./on-error";

/** The shape next-intl hands `onError`. */
class FakeIntlError extends Error {
  readonly code: string;
  constructor(code: string, originalMessage: string) {
    super(`${code}: ${originalMessage}`);
    this.code = code;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** `vi.stubEnv` rather than assigning: vitest's `process.env` refuses a redefine. */
function withNodeEnv(value: string) {
  vi.stubEnv("NODE_ENV", value);
}

describe("translatorOnError", () => {
  it("throws outside production, so a broken message fails where fixing it is free", () => {
    withNodeEnv("test");
    const error = new FakeIntlError("FORMATTING_ERROR", "The intl string context is invalid");
    expect(() => translatorOnError(error)).toThrow(error);
  });

  it("swallows in production, so one bad string costs one sentence and not the page", () => {
    withNodeEnv("production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => translatorOnError(new FakeIntlError("FORMATTING_ERROR", "bad"))).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("logs the error code and nothing that could carry a diver's data", () => {
    withNodeEnv("production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // `IntlError.message` embeds `originalMessage`, which for a diver-facing
    // string can hold an interpolated name, email or departure. The line must
    // be able to say "messages started failing" without saying whose.
    translatorOnError(
      new FakeIntlError("FORMATTING_ERROR", "Priya Sharma booked priya@example.com"),
    );
    const line = String(warn.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("i18n.message_format_failed");
    expect(line).toContain("FORMATTING_ERROR");
    expect(line).not.toContain("Priya Sharma");
    expect(line).not.toContain("priya@example.com");
  });

  it("still reports something for a throw that is not an IntlError", () => {
    withNodeEnv("production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    translatorOnError(new Error("something else entirely"));
    const line = String(warn.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("UNKNOWN");
    expect(line).not.toContain("something else entirely");
  });
});
