import { describe, expect, it } from "vitest";
import type { BookkeeperSetting } from "@/db/bookkeeper";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateWithYear } from "@/lib/format";
import { bookkeeperStatusLine } from "./bookkeeper-status";

const setting: BookkeeperSetting = {
  email: "books@example.com",
  setAt: new Date("2026-10-01T15:00:00.000Z"),
  setByPersonId: "00000000-0000-4000-8000-000000000001",
  setByName: "Olivia Owner",
  confirmedAt: new Date("2026-10-02T15:00:00.000Z"),
  bouncedAt: null,
};

function line(overrides: Partial<BookkeeperSetting>, locale = "en-US", setterCanExport = true) {
  return bookkeeperStatusLine(
    { ...setting, ...overrides },
    { setterCanExport, t: staffTranslator(locale), locale, timeZone: "America/New_York" },
  );
}

describe("the bookkeeper's status line (issue #2798)", () => {
  it("warns that the last month-end files bounced, naming the address", () => {
    const t = staffTranslator("en-US");
    const status = line({ bouncedAt: new Date("2026-10-02T16:00:00.000Z") });
    expect(status.tone).toBe("warning");
    expect(status.text).toContain(t("reports.bookkeeper.bounced", { email: "books@example.com" }));
  });

  it("says it in Spanish too", () => {
    const t = staffTranslator("es-ES");
    const status = line({ bouncedAt: new Date("2026-10-02T16:00:00.000Z") }, "es-ES");
    expect(status.text).toContain(t("reports.bookkeeper.bounced", { email: "books@example.com" }));
    expect(status.text).not.toBe(line({ bouncedAt: new Date() }).text);
  });

  it("is plain for a confirmed address with no bounce", () => {
    const t = staffTranslator("en-US");
    expect(line({})).toEqual({
      tone: "muted",
      text: t("reports.bookkeeper.setBy", {
        name: "Olivia Owner",
        date: formatDateWithYear(setting.setAt, "en-US", "America/New_York"),
      }),
    });
  });

  it("leads with a lapsed setter, which holds every send, over a bounce", () => {
    const t = staffTranslator("en-US");
    const status = line({ bouncedAt: new Date() }, "en-US", false);
    expect(status.text).toContain(t("reports.bookkeeper.setterLapsed"));
  });
});
