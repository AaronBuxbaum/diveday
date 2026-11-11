import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { sheetPrinted } from "./ShopSheet";

describe("sheet print attribution", () => {
  const at = new Date("2026-11-10T15:00:00Z");
  it("names the authenticated printer in the reader's language", () => {
    expect(
      sheetPrinted(staffTranslator("en-US"), at, "en-US", "America/New_York", " Morgan Lee "),
    ).toContain("Printed by Morgan Lee");
    expect(
      sheetPrinted(staffTranslator("es-ES"), at, "es-ES", "America/New_York", "Morgan Lee"),
    ).toContain("Impreso por Morgan Lee");
  });
  it("keeps the dated attribution without inventing a printer when no name is available", () => {
    const dated = sheetPrinted(staffTranslator("en-US"), at, "en-US", "America/New_York");
    expect(dated).toContain("Printed");
    expect(dated).toContain("EST");
    for (const name of [undefined, null, "", "   "]) {
      expect(sheetPrinted(staffTranslator("en-US"), at, "en-US", "America/New_York", name)).toBe(
        dated,
      );
    }
  });
});
