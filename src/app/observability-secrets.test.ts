import { describe, expect, it } from "vitest";
import { redactBreadcrumb, redactEvent } from "./observability";

describe("Sentry credential redaction", () => {
  it("scrubs embedded login links without dropping the useful error", () => {
    const event = redactEvent({
      type: undefined,
      exception: {
        values: [
          {
            value:
              "Mail to diver@example.com failed for https://dive.day/email-sign-in/secret-token",
          },
        ],
      },
    });
    expect(event.exception?.values?.[0].value).toBe(
      "Mail to diver@example.com failed for /email-sign-in/[token]",
    );
  });
  it("scrubs nested password fields and labeled passwords in console arguments", () => {
    const breadcrumb = redactBreadcrumb({
      category: "console",
      message: 'Login failed password="secret with spaces"',
      data: {
        arguments: [
          { email: "diver@example.com", password: "secret", nested: { newPassword: "next" } },
        ],
      },
    });
    expect(JSON.stringify(breadcrumb)).not.toContain("secret");
    expect(JSON.stringify(breadcrumb)).not.toContain('"next"');
    expect(JSON.stringify(breadcrumb)).toContain("diver@example.com");
  });
  it("scrubs event extras even without request metadata", () => {
    const event = redactEvent({
      type: undefined,
      extra: { redirect: "/reset-password/secret", current_password: "old" },
      message: "password=hidden&email=diver@example.com",
    });
    expect(event.extra).toEqual({
      redirect: "/reset-password/[token]",
      current_password: "[redacted]",
    });
    expect(event.message).toBe("password=[redacted]");
  });
  it("preserves ordinary diagnostic data and handles cycles", () => {
    const nested: Record<string, unknown> = {
      person: "diver@example.com",
      count: 3,
      missing: null,
    };
    nested.self = nested;
    const event = redactEvent({
      type: undefined,
      extra: nested,
      message: "Query failed on /shop/blue/divers/123",
    });
    expect(event.message).toBe("Query failed on /shop/blue/divers/123");
    expect(event.extra?.person).toBe("diver@example.com");
    expect(event.extra?.count).toBe(3);
  });
  it("redacts encoded link routes and links in stack frames", () => {
    const event = redactEvent({
      type: undefined,
      exception: {
        values: [
          { stacktrace: { frames: [{ filename: "https://dive.day/reset%2Dpassword/secret" }] } },
        ],
      },
    });
    expect(event.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe(
      "/reset-password/[token]",
    );
  });
  it("does not mutate or throw on application-owned frozen console data", () => {
    const credentials = Object.freeze({ password: "original", email: "diver@example.com" });
    const breadcrumb = redactBreadcrumb({
      category: "console",
      data: { arguments: [credentials, credentials] },
    });
    expect(credentials.password).toBe("original");
    expect(JSON.stringify(breadcrumb)).not.toContain("original");
  });
  it("scrubs onboarding owner passwords in fields and log text", () => {
    const event = redactEvent({
      type: undefined,
      extra: { ownerPassword: "secret" },
      message: "ownerPassword=secret",
    });
    expect(JSON.stringify(event)).not.toContain("secret");
  });
  it("preserves console Error diagnostics while removing credentials", () => {
    const breadcrumb = redactBreadcrumb({
      category: "console",
      data: { arguments: [new Error("Mail failed https://dive.day/email-sign-in/secret")] },
    });
    expect(JSON.stringify(breadcrumb)).toContain("Mail failed");
    expect(JSON.stringify(breadcrumb)).not.toContain("/secret");
  });
  it("preserves special diagnostic values without invoking getters", () => {
    const value = {
      date: new Date("2026-01-01T00:00:00Z"),
      invalidDate: new Date(Number.NaN),
      url: new URL("https://dive.day/email-sign-in/secret"),
      error: new Error("Mail failed", { cause: new Error("Delivery refused") }),
      get unsafe() {
        throw new Error("must not run");
      },
    };
    const breadcrumb = redactBreadcrumb({ data: value });
    expect(breadcrumb.data?.date).toBe("2026-01-01T00:00:00.000Z");
    expect(breadcrumb.data?.invalidDate).toBe("Invalid Date");
    expect(breadcrumb.data?.url).toBe("/email-sign-in/[token]");
    expect(JSON.stringify(breadcrumb)).toContain("Delivery refused");
    expect(breadcrumb.data?.unsafe).toBe("[accessor]");
  });
});
