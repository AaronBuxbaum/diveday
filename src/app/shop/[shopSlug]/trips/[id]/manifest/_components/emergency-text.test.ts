import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";
import {
  departureCaptain,
  type EmergencyTextFacts,
  emergencyTextBody,
  emergencyTextHref,
} from "./emergency-text";

const t = staffTranslator("en-US");
const es = staffTranslator("es-ES");

const facts: EmergencyTextFacts = {
  shopName: "Blue Mantis Divers",
  tripTitle: "Morning Two-Tank",
  startsAt: new Date("2026-07-20T13:00:00Z"),
  captainName: "Sam Reyes",
  locale: "en-US",
  timezone: "America/New_York",
};

function crew(fullName: string, roles: string[]): TripManifest["crew"][number] {
  return { id: fullName, fullName, roles } as TripManifest["crew"][number];
}

describe("emergencyTextBody", () => {
  it("names the shop, the person, the departure, its date and its captain", () => {
    const body = emergencyTextBody(t, facts, "Priya Sharma");
    for (const part of ["Blue Mantis Divers", "Priya Sharma", "Morning Two-Tank", "Sam Reyes"]) {
      expect(body).toContain(part);
    }
    expect(body).toMatch(/Jul\s20/);
  });

  it("still drafts without a captain on the roster, and never names one it does not have", () => {
    const body = emergencyTextBody(t, { ...facts, captainName: null }, "Priya Sharma");
    expect(body).toContain("Blue Mantis Divers");
    expect(body).not.toMatch(/Captain/);
  });

  it("drafts in the reader's language", () => {
    expect(emergencyTextBody(es, { ...facts, locale: "es-ES" }, "Priya Sharma")).toContain(
      "Blue Mantis Divers",
    );
    expect(emergencyTextBody(es, facts, "Priya")).not.toBe(emergencyTextBody(t, facts, "Priya"));
  });
});

describe("emergencyTextHref", () => {
  it("opens a draft to the number with separators removed and the words encoded", () => {
    expect(emergencyTextHref("+1 (305) 555-0142", "Call us & soon")).toBe(
      "sms:+13055550142?&body=Call%20us%20%26%20soon",
    );
  });

  it("keeps only a leading plus", () => {
    expect(emergencyTextHref("+44+20 7946 0958", "x")).toBe("sms:+442079460958?&body=x");
  });

  it("draws no link for a number with no digits", () => {
    expect(emergencyTextHref("ask at the desk", "x")).toBeNull();
    expect(emergencyTextHref("", "x")).toBeNull();
  });
});

describe("departureCaptain", () => {
  it("is the crew member rostered as captain, or nobody", () => {
    expect(departureCaptain([crew("Ana", ["divemaster"]), crew("Sam Reyes", ["captain"])])).toBe(
      "Sam Reyes",
    );
    expect(departureCaptain([crew("Ana", ["divemaster"])])).toBeNull();
    expect(departureCaptain([])).toBeNull();
  });
});
