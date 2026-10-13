import { describe, expect, it } from "vitest";
import { departureNoteEmail, departureNoteText, lostItemEmail, lostItemText } from "./desk-notes";

/**
 * Two desk messages to a diver: a note to a whole departure (J4) and
 * something found aboard (J2). The staffer's own words are a value, never a
 * template, and every value is escaped in the html body.
 */

const NOTE = {
  locale: "en-US" as const,
  diverName: "Mara <b>Lopez</b>",
  shopName: "Reef & Co",
  tripTitle: "Saturday <reef>",
  startsAt: new Date("2031-05-10T13:00:00Z"),
  timezone: "America/New_York",
  body: "Bring a 5mm {wetsuit} <script>alert(1)</script>",
  readinessUrl: "https://dive.day/ready/abc?x=1&y=2",
};

const LOST = {
  locale: "en-US" as const,
  diverName: "Mara Lopez",
  shopName: "Reef & Co",
  tripTitle: "Saturday <reef>",
  startsAt: new Date("2031-05-10T13:00:00Z"),
  timezone: "America/New_York",
  description: "blue mask <seat 4>",
};

describe("departureNoteEmail", () => {
  it("carries the staffer's words verbatim in text and escaped in html", () => {
    const email = departureNoteEmail(NOTE);
    expect(email.text).toContain(NOTE.body);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("Reef &amp; Co");
    expect(email.html).not.toContain("<b>");
    expect(email.subject).toContain(NOTE.tripTitle);
  });

  it("carries the diver's own booking link, and only when there is one", () => {
    const withLink = departureNoteEmail(NOTE);
    expect(withLink.text).toContain(NOTE.readinessUrl);
    expect(withLink.html).toContain('href="https://dive.day/ready/abc?x=1&amp;y=2"');
    const bare = departureNoteEmail({ ...NOTE, readinessUrl: undefined });
    expect(bare.text).not.toContain("https://");
    expect(bare.html).not.toContain("<a ");
  });

  it("speaks the diver's language", () => {
    expect(departureNoteEmail({ ...NOTE, locale: "es-ES" }).subject).not.toBe(
      departureNoteEmail(NOTE).subject,
    );
  });
});

describe("departureNoteText", () => {
  it("is one line with the link last", () => {
    const text = departureNoteText(NOTE);
    expect(text).not.toContain("\n");
    expect(text.endsWith(NOTE.readinessUrl)).toBe(true);
    expect(departureNoteText({ ...NOTE, readinessUrl: undefined })).not.toContain("https://");
  });
});

describe("lostItemEmail and lostItemText", () => {
  it("name the item, escaped in html, and the shop holding it", () => {
    const email = lostItemEmail(LOST);
    expect(email.text).toContain(LOST.description);
    expect(email.html).toContain("<strong>blue mask &lt;seat 4&gt;</strong>");
    expect(email.html).toContain("Reef &amp; Co");
    const text = lostItemText(LOST);
    expect(text).toContain(LOST.description);
    expect(text).toContain(LOST.shopName);
    expect(lostItemText({ ...LOST, locale: "es-ES" })).not.toBe(text);
  });
});
