import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { builderNoticeMessage } from "./builder-notices";

const st = staffTranslator("en-US");

describe("builderNoticeMessage", () => {
  it("names the certificate's limit when the redirect carried it (H-107)", () => {
    expect(builderNoticeMessage(st, "schedule.notices.capacityAboveCertificate", "10")).toBe(
      "The boat’s certificate allows 10 passengers. Pick a capacity no higher.",
    );
  });

  it("falls back to the plain sentence for a missing or edited number", () => {
    const plain = st("schedule.notices.capacityAboveCertificate");
    expect(builderNoticeMessage(st, "schedule.notices.capacityAboveCertificate", undefined)).toBe(
      plain,
    );
    expect(builderNoticeMessage(st, "schedule.notices.capacityAboveCertificate", "<b>")).toBe(
      plain,
    );
  });

  it("leaves every other notice alone", () => {
    expect(builderNoticeMessage(st, "schedule.notices.moved", "10")).toBe(
      st("schedule.notices.moved"),
    );
  });
});
