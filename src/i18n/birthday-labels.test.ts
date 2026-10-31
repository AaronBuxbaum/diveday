import { describe, expect, it } from "vitest";
import { birthdayCalloutText } from "./birthday-labels";
import { staffTranslator } from "./staff-messages";

describe.each([
  {
    locale: "en-US" as const,
    today: "Birthday today",
    upcomingOne: "Birthday in 1 day",
    upcomingMany: "Birthday in 7 days",
    recentOne: "Birthday 1 day ago",
    recentMany: "Birthday 2 days ago",
  },
  {
    locale: "es-ES" as const,
    today: "Cumpleaños hoy",
    upcomingOne: "Cumpleaños en 1 día",
    upcomingMany: "Cumpleaños en 7 días",
    recentOne: "Cumpleaños hace 1 día",
    recentMany: "Cumpleaños hace 2 días",
  },
])(
  "birthdayCalloutText ($locale)",
  ({ locale, today, upcomingOne, upcomingMany, recentOne, recentMany }) => {
    const t = staffTranslator(locale);

    it("names a birthday today", () => {
      expect(birthdayCalloutText(t, { status: "today" })).toBe(today);
    });

    it("names an upcoming birthday with singular and plural timing", () => {
      expect(birthdayCalloutText(t, { status: "soon", inDays: 1 })).toBe(upcomingOne);
      expect(birthdayCalloutText(t, { status: "soon", inDays: 7 })).toBe(upcomingMany);
    });

    it("names a recent birthday with singular and plural timing", () => {
      expect(birthdayCalloutText(t, { status: "recent", daysAgo: 1 })).toBe(recentOne);
      expect(birthdayCalloutText(t, { status: "recent", daysAgo: 2 })).toBe(recentMany);
    });
  },
);
