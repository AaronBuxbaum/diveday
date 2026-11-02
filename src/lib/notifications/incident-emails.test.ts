import { describe, expect, it } from "vitest";
import { incidentMissingDiverEmail } from "./incident-emails";
import { type Notification, notificationIdempotencyKey, notificationIsQueueable } from "./kinds";
import { shopVoiceOf } from "./shop-voice";

const input = {
  locale: "en-US" as const,
  recipientName: "Mara Quinn",
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  reportedAt: new Date("2026-10-01T15:20:00Z"),
  timezone: "America/New_York",
  reportUrl: "https://dive.day/shop/blue-mantis/trips/t/incidents/r",
  emergencyUrl: "https://dive.day/shop/blue-mantis/settings/emergency-reference",
};

const notification = {
  kind: "incident_missing_diver",
  shopId: "00000000-0000-4000-8000-000000000010",
  personId: "00000000-0000-4000-8000-000000000011",
  tripId: "00000000-0000-4000-8000-000000000012",
  incidentReportId: "00000000-0000-4000-8000-000000000013",
  to: "owner@dive.day",
  ...input,
} as Notification;

/** H-20261016-missing-diver-report-alerts: the owners' missing-diver alert says that, when, and where to look. Nothing else. */
describe("incidentMissingDiverEmail", () => {
  it("names the departure and the time, and links the report", () => {
    const email = incidentMissingDiverEmail(input);
    expect(email.subject).toBe("Blue Mantis: missing diver reported on Two-Tank Reef");
    expect(email.text).toContain("Mara");
    expect(email.text).toContain("Two-Tank Reef");
    expect(email.text).toContain(input.reportUrl);
    expect(email.html).toContain(input.reportUrl);
  });

  it("leads with the fact and the first call, and links the emergency reference", () => {
    const email = incidentMissingDiverEmail(input);
    expect(email.text).toMatch(
      /Missing diver on Two-Tank Reef\. Reported Oct\s1,\s11:20\sAM\sEDT\. Call the boat first\./,
    );
    expect(email.text).toContain(input.emergencyUrl);
    expect(email.html).toContain(input.emergencyUrl);
  });

  it("says it in Spanish for a Spanish-speaking owner", () => {
    const email = incidentMissingDiverEmail({ ...input, locale: "es-ES" });
    expect(email.subject).toContain("buceador desaparecido");
    expect(email.text).toContain(input.reportUrl);
    expect(email.text).toContain("Llama primero al barco.");
    expect(email.text).toContain(input.emergencyUrl);
  });

  it("escapes a trip title in the html body", () => {
    const email = incidentMissingDiverEmail({ ...input, tripTitle: "<script>x</script>" });
    expect(email.html).not.toContain("<script>");
  });
});

describe("the incident_missing_diver kind", () => {
  it("is keyed per report and owner, never queued, and sent in DiveDay's own voice", () => {
    expect(notificationIdempotencyKey(notification)).toBe(
      "incident-missing-diver/00000000-0000-4000-8000-000000000013/00000000-0000-4000-8000-000000000011",
    );
    expect(notificationIsQueueable(notification)).toBe(false);
    expect(shopVoiceOf(notification)).toBeNull();
  });
});
