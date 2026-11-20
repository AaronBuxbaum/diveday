import { describe, expect, it } from "vitest";
import { bookingConfirmationEmail } from "./email";

const base = {
  locale: "en-US" as const,
  diverName: "Pat Diver",
  shopName: "Blue Mantis",
  tripTitle: "Open Water Diver",
  startsAt: new Date("2026-08-01T13:00:00.000Z"),
  endsAt: new Date("2026-08-01T17:00:00.000Z"),
  timezone: "America/New_York",
};

/** The eLearning code the shop handed this student (ADR 20261120-course-elearning-codes). */
describe("bookingConfirmationEmail, with an eLearning code", () => {
  it("prints the code with the materials, escaped", () => {
    const email = bookingConfirmationEmail({
      ...base,
      learningMaterials: [{ name: "PADI eLearning", url: "https://www.padi.com/" }],
      elearningCode: "AB12-<CD>",
    });
    expect(email.text).toContain("Your eLearning code: AB12-<CD>");
    expect(email.html).toContain("Your eLearning code: AB12-&lt;CD&gt;");
    expect(email.html).not.toContain("<CD>");
  });

  it("prints the code for a course with no materials list, and nothing without one", () => {
    expect(bookingConfirmationEmail({ ...base, elearningCode: "ZZ99" }).text).toContain(
      "Your eLearning code: ZZ99",
    );
    expect(bookingConfirmationEmail(base).text).not.toContain("eLearning code");
  });
});
