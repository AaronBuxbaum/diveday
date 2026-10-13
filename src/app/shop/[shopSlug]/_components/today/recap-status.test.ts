import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { recapStatusLine } from "./recap-status";

const t = staffTranslator("en-US");
const now = new Date("2026-07-21T20:00:00Z");
const quiet = { recapSentAt: null, recapFailed: false, recapAutoSendPaused: false };
const minutes = (n: number) => n * 60_000;

describe("recapStatusLine", () => {
  it("says how long ago a sent recap went, in minutes under the hour", () => {
    const line = recapStatusLine(
      t,
      { ...quiet, recapSentAt: new Date(now.getTime() - minutes(25)) },
      null,
      now,
    );
    expect(line).toBe(
      t("closeout.recap.summarySent", {
        duration: t("closeout.recap.aboutMinutes", { count: 25 }),
      }),
    );
  });

  it("puts a failure ahead of a pause, and a pause ahead of the schedule", () => {
    const due = new Date(now.getTime() - minutes(1));
    expect(
      recapStatusLine(t, { ...quiet, recapFailed: true, recapAutoSendPaused: true }, due, now),
    ).toBe(t("closeout.recap.summaryFailed"));
    expect(recapStatusLine(t, { ...quiet, recapAutoSendPaused: true }, due, now)).toBe(
      t("closeout.recap.summaryPaused"),
    );
  });

  it("is due once its send time has passed, waiting before it, and silent with none", () => {
    expect(recapStatusLine(t, quiet, now, now)).toBe(t("closeout.recap.summaryDue"));
    expect(recapStatusLine(t, quiet, new Date(now.getTime() + minutes(150)), now)).toBe(
      t("closeout.recap.summaryWaiting", {
        duration: t("closeout.recap.aboutHours", { count: 3 }),
      }),
    );
    expect(recapStatusLine(t, quiet, null, now)).toBe(t("closeout.recap.summaryNoScheduled"));
  });
});
