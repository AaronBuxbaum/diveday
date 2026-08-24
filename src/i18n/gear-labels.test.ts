import { describe, expect, it } from "vitest";
import { GEAR_KIND_ORDER } from "@/lib/gear";
import { gearItemKindLabel } from "./gear-labels";
import { staffTranslator } from "./staff-messages";

describe("gear item kind labels", () => {
  it.each(["en-US", "es-ES"])("words every register kind in %s", (locale) => {
    const t = staffTranslator(locale);

    for (const kind of GEAR_KIND_ORDER) {
      const label = gearItemKindLabel(t, kind);
      expect(label.trim()).not.toBe("");
      expect(label).not.toBe(kind);
    }
  });
});
