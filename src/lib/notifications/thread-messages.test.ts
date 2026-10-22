// @vitest-environment node
import { describe, expect, it } from "vitest";
import { courseCertifiedEmail, courseCertifiedText } from "./course-certified";
import { leadReceivedAckEmail } from "./lead-received-ack";

/**
 * The two messages the third UX review's "thread between departures" adds:
 * the certification (item 14) and a date request's acknowledgment (item 13).
 */
describe("courseCertifiedEmail", () => {
  // Fourth review, item 40: the news said once, in the subject, and the body
  // answers where the card comes from rather than repeating it.
  it("names the course the shop ran, then who recorded it, where the card comes from, and what is next", () => {
    const email = courseCertifiedEmail({
      locale: "en-US",
      diverName: "Priya Raman",
      shopName: "Blue Mantis Divers",
      level: "open_water",
      courseTitle: "Open Water Diver",
      agency: "padi",
      recordedAt: new Date("2026-10-25T18:00:00Z"),
      timezone: "America/New_York",
      nextCourse: {
        title: "Advanced Open Water Diver",
        url: "https://diveday.test/s/blue-mantis/courses/advanced",
      },
    });
    expect(email.subject).toBe("You’ve finished Open Water Diver, Priya");
    expect(email.text).toMatch(/^Recorded by Blue Mantis Divers on Sun, Oct\s25\./);
    // Counts *here*: another operator has no such record and will ask for the card.
    expect(email.text).toContain(
      "Your card is on its way from PADI; this record already counts with Blue Mantis Divers.",
    );
    expect(email.text).not.toContain("You’");
    expect(email.text).toContain("Your next course: Advanced Open Water Diver");
    expect(email.html).toContain('href="https://diveday.test/s/blue-mantis/courses/advanced"');
  });

  it("never names DiveDay's rung for another agency's card", () => {
    // SSI's Advanced Adventurer sits on the advanced_open_water rung, but SSI
    // has a different rating called Advanced Open Water Diver.
    const email = courseCertifiedEmail({
      locale: "en-US",
      diverName: "Priya Raman",
      shopName: "Blue Mantis Divers",
      level: "advanced_open_water",
      courseTitle: "Advanced Adventurer",
      agency: "ssi",
      recordedAt: new Date("2026-10-25T18:00:00Z"),
      timezone: "America/New_York",
    });
    expect(email.subject).toBe("You’ve finished Advanced Adventurer, Priya");
    expect(`${email.subject} ${email.text}`).not.toContain("Advanced Open Water");
  });

  it("says Junior to a diver under 15", () => {
    const email = courseCertifiedEmail({
      locale: "en-US",
      diverName: "Mia Lopez",
      shopName: "Blue Mantis Divers",
      level: "open_water",
      junior: true,
      recordedAt: new Date("2026-10-25T18:00:00Z"),
      timezone: "America/New_York",
    });
    expect(email.subject).toBe("You’re a Junior Open Water Diver, Mia");
    expect(email.text).toContain("Until you turn 15 it’s a Junior card");
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
    expect(email.text).toContain(
      "Your card is on its way from your training agency; this record already counts with Blue Mantis Divers.",
    );
  });

  it("says it in Spanish as a text, naming the course", () => {
    expect(
      courseCertifiedText({
        locale: "es-ES",
        shopName: "Blue Mantis",
        level: "open_water",
        courseTitle: "Open Water Diver",
      }),
    ).toBe(
      "Blue Mantis: terminaste Open Water Diver. Tu agencia te enviará la tarjeta; este registro ya cuenta en Blue Mantis.",
    );
    expect(
      courseCertifiedText({
        locale: "es-ES",
        shopName: "Blue Mantis",
        level: "open_water",
        junior: true,
      }),
    ).toBe(
      "Blue Mantis: ya tienes tu certificación Junior Open Water. Hasta que cumplas 15 es una tarjeta Junior, con un límite de profundidad menor. Tu agencia te enviará la tarjeta; este registro ya cuenta en Blue Mantis.",
    );
  });
});

describe("leadReceivedAckEmail", () => {
  it("says what was asked, when, and how to reach the shop sooner", () => {
    const email = leadReceivedAckEmail({
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
    // The body adds what the subject does not: nothing is held yet (fourth
    // review, item 49). Never a second "we have your request".
    expect(email.text).toContain("Nothing is booked or held yet.");
    expect(email.text).not.toMatch(/have your request/i);
    expect(email.text).toMatch(/You asked for Oct\s25, 2026, or Nov\s1, 2026\./);
    expect(email.text).toContain("To talk sooner, call +1 305 555 0100.");
    expect(email.text).toMatch(/Desk open 7:00\sAM to 5:00\sPM/);
  });

  it("leaves out what the shop has not given and never names a course it was not asked about", () => {
    const email = leadReceivedAckEmail({
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
