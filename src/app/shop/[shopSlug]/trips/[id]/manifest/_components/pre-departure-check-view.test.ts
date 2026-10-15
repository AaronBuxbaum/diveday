import { describe, expect, it } from "vitest";
import { t } from "./diver-roll-call-test-fixtures";
import { preDepartureCheckView } from "./pre-departure-check-view";

describe("preDepartureCheckView", () => {
  it("says who checked what, keeps a sentence for paper, and counts the checked", () => {
    const view = preDepartureCheckView({
      checklistItems: [
        { id: "radio", label: "Radio check" },
        { id: "o2", label: "Oxygen kit" },
      ] as never,
      checklistChecks: new Map([
        [
          "radio",
          { recordedByName: "Keiko Tanaka", occurredAt: new Date("2026-09-11T11:40:00.000Z") },
        ],
      ]) as never,
      locale: "en-US",
      timeZone: "America/New_York",
      t,
    });
    expect(view.items[0]?.checkedByLine).toContain("Keiko Tanaka");
    expect(view.items[1]?.checkedByLine).toBeUndefined();
    expect(view.items[1]?.printLine).toBe(
      t("trips.preDepartureCheck.printLineNotChecked", { label: "Oxygen kit" }),
    );
    expect(view.copy.summary).toBe(t("trips.preDepartureCheck.summary", { checked: 1, total: 2 }));
  });

  it("hands an earlier crew's snag on above the list and keeps this crew's under its line", () => {
    const snag = (id: string, notedHere: boolean, checklistItemId: string) => ({
      id,
      checklistItemId,
      itemLabel: checklistItemId === "radio" ? "Radio check" : "Oxygen kit",
      note: notedHere ? "Spare cylinder low" : "VHF crackles on 16",
      notedByName: "Sal Moretti",
      notedAt: new Date("2026-09-11T09:16:00.000Z"),
      notedHere,
      stillThere: null,
    });
    const view = preDepartureCheckView({
      checklistItems: [
        { id: "radio", label: "Radio check" },
        { id: "o2", label: "Oxygen kit" },
      ] as never,
      checklistChecks: new Map() as never,
      snags: [snag("a", false, "radio"), snag("b", true, "o2")],
      canNoteSnags: true,
      locale: "en-US",
      timeZone: "America/New_York",
      t,
    });
    expect(view.carried.map((carried) => carried.line)).toEqual([
      t("trips.preDepartureCheck.snagLine", { item: "Radio check", note: "VHF crackles on 16" }),
    ]);
    expect(view.carried[0]?.notedBy).toContain("Sal Moretti");
    expect(view.items[0]?.snags).toEqual([]);
    expect(view.items[1]?.snags.map((here) => here.note)).toEqual(["Spare cylinder low"]);
    expect(view.canNoteSnags).toBe(true);
  });
});
