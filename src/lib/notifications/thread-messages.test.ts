// @vitest-environment node
import { describe, expect, it } from "vitest";
import { courseCertifiedEmail, courseCertifiedText } from "./course-certified";
import { courseInquiryReceivedEmail } from "./course-inquiry-received";

/**
 * The two messages the third UX review's "thread between departures" adds:
 * the certification (item 14) and a date request's acknowledgment (item 13).
 */
describe("courseCertifiedEmail", () => {
  // Fourth review, item 40: the news said once, in the subject, and the body
  // answers where the card comes from rather than repeating it.
  it("says the news once, then who recorded it, where the card comes from, and what is next", () => {
    const email = courseCertifiedEmail({
      locale: "en-US",
      diverName: "Priya Raman",
      shopName: "Blue Mantis Divers",
      level: "open_water",
      agency: "padi",
      recordedAt: new Date("2026-10-25T18:00:00Z"),
      timezone: "America/New_York",
      nextCourse: {
        title: "Advanced Open Water Diver",
        url: "https://diveday.test/s/blue-mantis/courses/advanced",
      },
    });
    expect(email.subject).toBe("You’re an Open Water Diver, Priya");
    expect(email.text).toMatch(/^Recorded by Blue Mantis Divers on Sun, Oct\s25\./);
    expect(email.text).toContain("Your PADI card comes from PADI; this record already counts.");
    expect(email.text).not.toContain("You’re");
    expect(email.text).toContain("Your next course: Advanced Open Water Diver");
    expect(email.html).toContain('href="https://diveday.test/s/blue-mantis/courses/advanced"');
  });

  it("escapes the shop's name in the html body", () => {
    const email = courseCertifiedEmail({
      locale: "en-US",
      diverName: "Priya Raman",
      shopName: "<b>Mantis</b>",
      level: "rescue",
      recordedAt: new Date("2026-10-25T18:00:00Z"),
      timezone: "America/New_York",
    });
    expect(email.html).not.toContain("<b>Mantis</b>");
    expect(email.html).toContain("&lt;b&gt;Mantis&lt;/b&gt;");
  });

  it("names no agency it does not know, and takes the article the level needs", () => {
    const email = courseCertifiedEmail({
      locale: "en-US",
      diverName: "Sam Lee",
      shopName: "Blue Mantis Divers",
      level: "rescue",
      agency: "other",
      recordedAt: new Date("2026-10-25T18:00:00Z"),
      timezone: "America/New_York",
    });
    expect(email.subject).toBe("You’re a Rescue Diver, Sam");
    expect(email.text).toContain("Your card comes from your training agency;");
  });

  it("says it in Spanish as a text", () => {
    expect(
      courseCertifiedText({ locale: "es-ES", shopName: "Blue Mantis", level: "open_water" }),
    ).toBe(
      "Blue Mantis: ya tienes tu certificación Open Water. La tarjeta te la envía tu agencia; este registro ya cuenta.",
    );
  });
});

describe("courseInquiryReceivedEmail", () => {
  it("says what was asked, when, and how to reach the shop sooner", () => {
    const email = courseInquiryReceivedEmail({
      locale: "en-US",
      shopName: "Blue Mantis Divers",
      courseTitle: "Advanced Open Water Diver",
      preferredDate: "2026-10-25",
      alternateDate: "2026-11-01",
      shopPhone: "+13055550100",
      deskHours: { opensMinute: 420, closesMinute: 1020 },
      timezone: "America/New_York",
    });
    expect(email.subject).toBe("Blue Mantis Divers has your request");
    expect(email.text).toContain("Thanks for asking about Advanced Open Water Diver.");
    expect(email.text).toMatch(/You asked for Oct\s25, 2026, or Nov\s1, 2026\./);
    expect(email.text).toContain("To talk sooner, call +1 305 555 0100.");
    expect(email.text).toMatch(/Desk open 7:00\sAM to 5:00\sPM/);
  });

  it("leaves out what the shop has not given and never names a course it was not asked about", () => {
    const email = courseInquiryReceivedEmail({
      locale: "en-US",
      shopName: "Blue Mantis Divers",
      timezone: "America/New_York",
    });
    expect(email.text).toContain("Thanks for asking about a day of diving.");
    expect(email.text).not.toContain("You asked for");
    expect(email.text).not.toContain("call");
    expect(email.text).not.toContain("Desk open");
  });
});
