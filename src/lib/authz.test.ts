import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/messages";
import { DIVER_LOCALES, type DiverLocale } from "@/i18n/settings";
import {
  ALL_ROLES,
  canConfigureTrips,
  canDeleteDiver,
  canExportIncidentRecord,
  canExportShopData,
  canImportShopData,
  canManageMessagingSettings,
  canManageOrders,
  canManagePaymentSettings,
  canManageStaffAccounts,
  canManageWaiverTemplates,
  canOverrideGearRequest,
  canReadMedicalClearanceDocument,
  canReadPrivateRecapPulse,
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
    // #1283: the physician's evaluation. Same boundary as the shop-wide export,
    // which already hands a manager every diver's signed medical answers in
    // bulk — gating one letter tighter than the questionnaires beneath it would
    // move the door without moving the wall.
    ["canReadMedicalClearanceDocument", canReadMedicalClearanceDocument],
    // #1410: what a diver privately asked the shop to fix. Same boundary as the
    // physician's letter above, and promised to the diver in as many words —
    // the roster below holds the promise to the role set.
    ["canReadPrivateRecapPulse", canReadPrivateRecapPulse],
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

describe("canExportIncidentRecord (owner only)", () => {
  it("admits only the owner — tighter than every other staff gate", () => {
    expect(canExportIncidentRecord(["owner"])).toBe(true);
    // Deliberately narrower than the owner/manager gate on the full-shop
    // export, and narrower than trip configuration: the incident export is the
    // shop's own account of a departure, stamped with its generator's name.
    for (const role of [
      "manager",
      "instructor",
      "divemaster",
      "captain",
      "crew",
      "diver",
    ] as const) {
      expect(canExportIncidentRecord([role])).toBe(false);
    }
    expect(canExportShopData(["manager"])).toBe(true);
  });

  it("admits an owner who also holds an operating role", () => {
    expect(canExportIncidentRecord(["captain", "owner"])).toBe(true);
  });

  it("rejects empty and undefined roles", () => {
    expect(canExportIncidentRecord([])).toBe(false);
    expect(canExportIncidentRecord(undefined)).toBe(false);
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

/**
 * **The recap form names the pulse's readers, so the gate and the sentence are
 * one fact held in two places** (D40, issue #1200; the narrowing is #1410).
 *
 * `recap.pulseAudience` is shown to a diver deciding whether to type the thing
 * they did not want to say in public: "Just for the owner and managers at
 * {shop}."
 * That is a promise, and the only thing that makes it true is which roles
 * `canReadPrivateRecapPulse` admits. Nothing else connects them — widen the
 * gate and the sentence goes quietly false, which is the exact failure the
 * predicate was split off the reports gate to prevent (security review, the
 * RFH-05 layer). This is the check that turns red instead.
 */
describe("canReadPrivateRecapPulse and the promise on the recap form", () => {
  /**
   * The word each bundle uses for a role, so "does the sentence name this
   * role" is a question the test can ask. A locale that widened the gate would
   * have to add its word here to go green, which is the point: the rewrite of
   * the promise and the widening of the gate land in the same change.
   */
  const ROLE_WORDS: Record<DiverLocale, Record<Role, string>> = {
    "en-US": {
      owner: "owner",
      manager: "manager",
      instructor: "instructor",
      divemaster: "divemaster",
      captain: "captain",
      crew: "crew",
      diver: "diver",
    },
    "es-ES": {
      owner: "propietario",
      manager: "gerente",
      instructor: "instructor",
      divemaster: "divemaster",
      captain: "capitán",
      crew: "tripulación",
      diver: "buceador",
    },
  };

  for (const locale of DIVER_LOCALES) {
    it(`names every role the gate admits and no others (${locale})`, () => {
      const sentence = messagesFor(locale).recap.pulseAudience.toLowerCase();
      for (const role of ALL_ROLES) {
        // Paired with the role so a failure says which one drifted.
        expect([role, sentence.includes(ROLE_WORDS[locale][role])]).toEqual([
          role,
          canReadPrivateRecapPulse([role]),
        ]);
      }
    });
  }
});
