import { describe, expect, it } from "vitest";
import { readinessLinkEmail } from "./email";

const base = {
  locale: "en-US" as const,
  diverName: "Pat Diver",
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-08-01T13:00:00.000Z"),
  endsAt: new Date("2026-08-01T17:00:00.000Z"),
  timezone: "America/New_York",
};

/**
 * **A link the diver asked for from another day's page** (H-20261014-other-days-send-fresh). Neither
 * purpose may say a link of theirs expired: nothing did.
 */
describe("readinessLinkEmail for another of the diver's days", () => {
  const link = {
    ...base,
    readinessUrl: "https://diveday.test/ready/abc",
    expiresAt: new Date("2026-09-01T13:00:00.000Z"),
  };

  it("words an upcoming day as the link they asked for", () => {
    const email = readinessLinkEmail({ ...link, purpose: "other_day" });
    expect(email.subject).toBe("Your link for Two-Tank Reef");
    expect(email.text).toContain("the link you asked for");
    expect(email.text).not.toMatch(/expired/);
  });

  it("words a past day as its log entry", () => {
    const email = readinessLinkEmail({ ...link, purpose: "log_entry" });
    expect(email.subject).toBe("Your log entry for Two-Tank Reef");
    expect(email.html).toContain("Open your log entry");
    expect(email.text).not.toMatch(/expired/);
  });
});
