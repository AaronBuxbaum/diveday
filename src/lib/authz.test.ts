import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  canExportShopData,
  canImportShopData,
  canViewShopReports,
  isStaff,
  type Role,
} from "./authz";

describe("isStaff", () => {
  it("accepts any staff role", () => {
    expect(isStaff(["owner"])).toBe(true);
    expect(isStaff(["diver", "divemaster"])).toBe(true);
    expect(isStaff([])).toBe(false);
    expect(isStaff(undefined)).toBe(false);
    expect(isStaff(["crew"])).toBe(true);
    expect(isStaff(["diver"])).toBe(false);
  });
});

const NON_ACCOUNTABLE_STAFF_ROLES: readonly Role[] = ALL_ROLES.filter(
  (role) => role !== "owner" && role !== "manager",
);

describe("accountable-role gates (export/import/reports)", () => {
  const gates = [
    ["canExportShopData", canExportShopData],
    ["canImportShopData", canImportShopData],
    ["canViewShopReports", canViewShopReports],
  ] as const;

  for (const [name, gate] of gates) {
    describe(name, () => {
      it("admits owner and manager", () => {
        expect(gate(["owner"])).toBe(true);
        expect(gate(["manager"])).toBe(true);
      });

      it("rejects every other staff role individually", () => {
        for (const role of NON_ACCOUNTABLE_STAFF_ROLES) {
          expect(gate([role])).toBe(false);
        }
      });

      it("admits when an accountable role is mixed in with others", () => {
        expect(gate(["instructor", "manager"])).toBe(true);
      });

      it("rejects empty and undefined roles", () => {
        expect(gate([])).toBe(false);
        expect(gate(undefined)).toBe(false);
      });
    });
  }
});
