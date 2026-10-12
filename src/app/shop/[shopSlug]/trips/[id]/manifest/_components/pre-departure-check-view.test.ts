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
});
