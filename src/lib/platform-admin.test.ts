import { describe, expect, it } from "vitest";
import { isPlatformAdminEmail, platformAdminEmails } from "./platform-admin";

/**
 * The allowlist is the whole operator gate (20260724-resend-webhook-email-events),
 * so its parsing is a security boundary rather than a formatting nicety: every
 * way an entry can be written wrong should read as "not an operator".
 */
describe("platformAdminEmails", () => {
  it("reads a comma-separated list, tolerating the spacing people actually type", () => {
    expect(platformAdminEmails({ PLATFORM_ADMIN_EMAILS: "a@dive.day,  b@dive.day " })).toEqual([
      "a@dive.day",
      "b@dive.day",
    ]);
  });

  it("normalizes case, so a capitalized address in the deploy config still matches", () => {
    expect(platformAdminEmails({ PLATFORM_ADMIN_EMAILS: "Aaron@Dive.Day" })).toEqual([
      "aaron@dive.day",
    ]);
  });

  it("drops entries that aren't addresses instead of granting on them", () => {
    // A trailing comma is the common one; "*" is the one that would be a
    // disaster if an empty or wildcard entry ever matched something.
    expect(platformAdminEmails({ PLATFORM_ADMIN_EMAILS: "a@dive.day,,*, ops" })).toEqual([
      "a@dive.day",
    ]);
  });

  it("is empty when unset, so an unconfigured deploy has no operators", () => {
    expect(platformAdminEmails({})).toEqual([]);
    expect(platformAdminEmails({ PLATFORM_ADMIN_EMAILS: "" })).toEqual([]);
  });
});

describe("isPlatformAdminEmail", () => {
  const env = { PLATFORM_ADMIN_EMAILS: "aaron@dive.day, ops@dive.day" };

  it("matches an allowlisted address regardless of how it's cased or padded", () => {
    expect(isPlatformAdminEmail(" Aaron@Dive.Day ", env)).toBe(true);
  });

  it("refuses an address that isn't on the list", () => {
    expect(isPlatformAdminEmail("dana@bluemantis.example", env)).toBe(false);
  });

  it("refuses a person with no email on file rather than matching an empty entry", () => {
    expect(isPlatformAdminEmail(null, env)).toBe(false);
    expect(isPlatformAdminEmail(undefined, env)).toBe(false);
    expect(isPlatformAdminEmail("   ", env)).toBe(false);
  });

  it("fails closed when the allowlist is unset", () => {
    expect(isPlatformAdminEmail("aaron@dive.day", {})).toBe(false);
  });
});
