import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { signScheduleMoveResult } from "@/lib/schedule-move-result";
import { builderNoticeFor, builderNoticeMessage, verifiedGearMoveNotice } from "./builder-notices";

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

  it("counts the departures a week copy put up (fifth loop, item 30)", () => {
    expect(builderNoticeMessage(st, "schedule.notices.weekCopied", "6")).toBe(
      "Copied 6 departures from last year. Add their crew from each one’s page.",
    );
  });

  it("leaves every other notice alone", () => {
    expect(builderNoticeMessage(st, "schedule.notices.moved", "10")).toBe(
      st("schedule.notices.moved"),
    );
  });
});

describe("builderNoticeFor", () => {
  const none = { count: undefined, created: undefined, series: undefined, st };

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

  it("keeps a move query at its ordinary success notice without a verified action result", () => {
    expect(builderNoticeFor({ ...none, builder: "moved" })).toEqual({
      tone: "success",
      message: st("schedule.notices.moved"),
    });
  });
});

describe("verifiedGearMoveNotice", () => {
  it("shows the signed count from a real move and ignores fabricated result values", () => {
    const shopId = "b22e9ed4-d836-47a0-a019-a88ac462a488";
    const id = "6b9de0d1-80c3-4245-b5d1-a57c2f9f74b3";
    const result = signScheduleMoveResult(shopId, id, 5);
    expect(verifiedGearMoveNotice(result, shopId, st)).toEqual({
      id,
      message: st("schedule.notices.movedGearReleased", { count: 5 }),
    });
    expect(verifiedGearMoveNotice("anything", shopId, st)).toBeNull();
    expect(verifiedGearMoveNotice(result, "f04f4175-d8b0-4f02-a2a3-c2e05f496345", st)).toBeNull();
  });
});
