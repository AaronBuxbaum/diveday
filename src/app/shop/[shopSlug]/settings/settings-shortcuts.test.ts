import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { settingsShortcutsFor } from "./settings-groups";

const t = staffTranslator("en-US");
const shop = { hasBoatDiving: true, isDemo: false };

/** ⌘K reaches a setting: the rail's rows, for a reader inside the settings gate. */
describe("settingsShortcutsFor", () => {
  it("offers an owner every rail row, worded, grouped and linked", () => {
    const rows = settingsShortcutsFor(shop, ["owner"], "blue-mantis", t);
    expect(rows.find((row) => row.id === "tips")).toEqual({
      id: "tips",
      label: t("settings.main.features.tips.heading"),
      group: t("settings.main.groups.features"),
      href: "/shop/blue-mantis/settings/features#tips",
    });
    expect(rows.find((row) => row.id === "deskHours")?.href).toBe(
      "/shop/blue-mantis/settings#desk-hours",
    );
    expect(rows.find((row) => row.id === "rentals")?.href).toBe(
      "/shop/blue-mantis/settings/rentals",
    );
    expect(rows.map((row) => row.id)).toContain("billing");
    for (const row of rows) expect(row.group).not.toBe("");
  });

  it("offers nothing to a reader outside the settings gate", () => {
    expect(settingsShortcutsFor(shop, ["divemaster"], "blue-mantis", t)).toEqual([]);
    expect(settingsShortcutsFor(shop, ["instructor", "captain"], "blue-mantis", t)).toEqual([]);
    expect(settingsShortcutsFor(shop, [], "blue-mantis", t)).toEqual([]);
  });

  it("hides what the rail hides: billing from a manager and a demo, boats from a shore shop", () => {
    const manager = settingsShortcutsFor(shop, ["manager"], "blue-mantis", t).map((row) => row.id);
    expect(manager).not.toContain("billing");
    expect(manager).toContain("tips");
    expect(manager).toContain("divingOptions");
    const demo = settingsShortcutsFor({ ...shop, isDemo: true }, ["owner"], "x", t);
    expect(demo.map((row) => row.id)).not.toContain("billing");
    const shore = settingsShortcutsFor({ ...shop, hasBoatDiving: false }, ["owner"], "x", t);
    expect(shore.map((row) => row.id)).not.toContain("boats");
  });
});
