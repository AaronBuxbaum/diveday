import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  canConfigureTrips,
  canDeleteDiver,
  canExportShopData,
  canImportShopData,
  canManageMessagingSettings,
  canManageOrders,
  canManagePaymentSettings,
  canManageStaffAccounts,
  canManageWaiverTemplates,
  canOverrideGearRequest,
  canRefund,
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
    // H-14: money, legal templates, and roster deletion share the same gate.
    ["canManagePaymentSettings", canManagePaymentSettings],
    ["canRefund", canRefund],
    // H-14 extended: raising an invoice is the same money work as refunding one.
    ["canManageOrders", canManageOrders],
    ["canManageWaiverTemplates", canManageWaiverTemplates],
    ["canDeleteDiver", canDeleteDiver],
    // 20260726-staff-invite-accounts: invite/edit-roles/disable/remove share the same gate.
    ["canManageStaffAccounts", canManageStaffAccounts],
    // 20260802-whatsapp-cloud-api-per-shop: a credential that sends as the business.
    ["canManageMessagingSettings", canManageMessagingSettings],
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

describe("canConfigureTrips (H-14 — owner/manager/instructor)", () => {
  it("admits owner, manager, and instructor", () => {
    expect(canConfigureTrips(["owner"])).toBe(true);
    expect(canConfigureTrips(["manager"])).toBe(true);
    expect(canConfigureTrips(["instructor"])).toBe(true);
  });

  it("rejects the operating crew — captain, crew, divemaster — and divers", () => {
    for (const role of ["captain", "crew", "divemaster", "diver"] as const) {
      expect(canConfigureTrips([role])).toBe(false);
    }
  });

  it("admits when an allowed role is mixed with disallowed ones", () => {
    expect(canConfigureTrips(["captain", "instructor"])).toBe(true);
  });

  it("rejects empty and undefined roles", () => {
    expect(canConfigureTrips([])).toBe(false);
    expect(canConfigureTrips(undefined)).toBe(false);
  });
});

describe("canOverrideGearRequest (H-06 — owner/manager/instructor/divemaster)", () => {
  it("admits the in-water judgement roles, divemaster included", () => {
    expect(canOverrideGearRequest(["owner"])).toBe(true);
    expect(canOverrideGearRequest(["manager"])).toBe(true);
    expect(canOverrideGearRequest(["instructor"])).toBe(true);
    // Wider than canConfigureTrips on purpose: a divemaster sizes divers.
    expect(canOverrideGearRequest(["divemaster"])).toBe(true);
    expect(canConfigureTrips(["divemaster"])).toBe(false);
  });

  it("rejects deck crew and divers", () => {
    for (const role of ["captain", "crew", "diver"] as const) {
      expect(canOverrideGearRequest([role])).toBe(false);
    }
  });

  it("rejects empty and undefined roles", () => {
    expect(canOverrideGearRequest([])).toBe(false);
    expect(canOverrideGearRequest(undefined)).toBe(false);
  });
});
