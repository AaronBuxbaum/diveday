import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
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

/**
 * The 2026-08-14 `t()` -> `t.raw()` sweep converted every no-argument call whose
 * message carried a `{placeholder}`. That heuristic was one case too broad: a
 * message can carry braces because it is *documentation about* placeholders,
 * escaped for ICU as `'{depth18}'` so `t()` renders them literally. `t.raw()`
 * skips the unescaping, so the course editor's depth-marker help started
 * showing readers `'{depth18}'` — escape quotes and all — instead of
 * `{depth18}`, which is the exact text it is telling them to type. Caught by a
 * visual capture, not by a test, which is why there is now a test.
 */
describe("ICU-escaped messages must not be fetched raw", () => {
  const staffDir = "src/i18n/locales/en-US/staff";
  const bundles = [
    ...readdirSync(staffDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(staffDir, f)),
    "src/i18n/locales/en-US/diver.json",
  ];

  /** Every .ts/.tsx under src, minus the bundles themselves. */
  function sourceFiles(dir = "src"): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full.includes("locales")) continue;
        out.push(...sourceFiles(full));
      } else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const escapedKeys = new Set<string>();
  for (const file of bundles) {
    const ns = file.includes("/staff/") ? `${basename(file, ".json")}.` : "";
    const walk = (obj: Record<string, unknown>, prefix: string) => {
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === "object") walk(v as Record<string, unknown>, `${prefix}${k}.`);
        else if (typeof v === "string" && v.includes("'{")) escapedKeys.add(`${prefix}${k}`);
      }
    };
    walk(JSON.parse(readFileSync(file, "utf8")), ns);
  }

  it("finds the escaped messages it is guarding", () => {
    // If this drops to zero the guard below is vacuous — the bundles changed
    // shape, not the risk.
    expect(escapedKeys.size).toBeGreaterThan(0);
  });

  it.each([...escapedKeys])("%s is never read through t.raw()", (key) => {
    const offenders = sourceFiles().filter((file) =>
      readFileSync(file, "utf8").includes(`t.raw("${key}")`),
    );
    expect(offenders).toEqual([]);
  });
});
