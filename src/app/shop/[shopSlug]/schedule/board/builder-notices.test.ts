import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { builderNoticeFor, builderNoticeMessage } from "./builder-notices";

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

describe("builderNoticeFor", () => {
  const none = { count: undefined, created: undefined, gear: undefined, series: undefined, st };

  it("says nothing for an unknown or missing outcome", () => {
    expect(builderNoticeFor({ ...none, builder: undefined })).toBeUndefined();
    expect(builderNoticeFor({ ...none, builder: "nope" })).toBeUndefined();
  });

  it("names the departure just added, and the series count when it put up several", () => {
    expect(builderNoticeFor({ ...none, builder: "added", created: "Night Dive" })).toEqual({
      tone: "success",
      message: st("schedule.notices.addedNamed", { title: "Night Dive" }),
    });
    expect(
      builderNoticeFor({ ...none, builder: "added", created: "Night Dive", series: "4" })?.message,
    ).toBe(st("schedule.notices.addedSeries", { title: "Night Dive", count: 4 }));
  });

  it("warns when a move had to release gear", () => {
    expect(builderNoticeFor({ ...none, builder: "moved", gear: "2" })).toEqual({
      tone: "warning",
      message: st("schedule.notices.movedGearReleased", { count: 2 }),
    });
    expect(builderNoticeFor({ ...none, builder: "moved", gear: "0" })?.tone).toBe("success");
  });
});
