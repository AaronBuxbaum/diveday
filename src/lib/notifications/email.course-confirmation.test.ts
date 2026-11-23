import { describe, expect, it } from "vitest";
import { bookingConfirmationEmail } from "./email";

// Issue #4909: a course day's confirmation says arrive and first day, never boat, dock or sail.
const course = {
  locale: "en-US" as const,
  diverName: "Pat Diver",
  shopName: "Blue Mantis",
  tripTitle: "Open Water Diver, day 1",
  startsAt: new Date("2026-08-01T13:00:00.000Z"),
  endsAt: new Date("2026-08-01T17:00:00.000Z"),
  timezone: "America/New_York",
  courseSession: true,
  readinessUrl: "https://example.test/ready/abc",
  waiverUrl: "https://example.test/ready/abc/waiver",
  money: {
    due: "deposit" as const,
    depositCents: 20000,
    balanceCents: 31500,
    currency: "USD",
  },
};

describe("bookingConfirmationEmail for a course day", () => {
  for (const locale of ["en-US", "es-ES"] as const) {
    it(`says nothing of a boat, dock or sailing in ${locale}`, () => {
      const email = bookingConfirmationEmail({ ...course, locale });
      const words =
        locale === "en-US"
          ? /\b(boat|dock|sail|sails|sailing|board)\b/i
          : /\b(barco|bordo|muelle|zarpar|zarpa|salir)\b/i;
      expect(`${email.subject}\n${email.text}\n${email.html}`).not.toMatch(words);
    });
  }

  it("tells a student when to arrive, and when the balance is due", () => {
    const email = bookingConfirmationEmail(course);
    expect(email.subject).toBe("You’re enrolled: Open Water Diver, day 1");
    expect(email.text).toContain("Please arrive 30 minutes early");
    expect(email.text).toContain("then $315.00 at the shop on");
    expect(email.text).toContain("See what’s left before your first day");
    expect(email.text).toContain("before your first day");
  });

  it("leaves a boat day's wording alone", () => {
    const email = bookingConfirmationEmail({ ...course, courseSession: undefined });
    expect(email.subject).toBe("You’re on the boat: Open Water Diver, day 1");
    expect(email.text).toContain("be at the dock 30 minutes early");
  });
});
