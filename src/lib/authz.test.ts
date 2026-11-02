import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/messages";
import { DIVER_LOCALES, type DiverLocale } from "@/i18n/settings";
import {
  ALL_ROLES,
  canAddDiver,
  canBackfillIntegrations,
  canCallDayBlowout,
  canConfigureTrips,
  canDeleteDiver,
  canEmergencyReadMedicalAlert,
  canErasePersonalData,
  canExportDisputeSheet,
  canExportIncidentRecord,
  canExportShopData,
  canImportShopData,
  canManageBilling,
  canManageBoats,
  canManageMessagingSettings,
  canManageOrders,
  canManagePaymentSettings,
  canManageSafetyChecklist,
  canManageStaffAccounts,
  canManageTripTags,
  canManageWaiverTemplates,
  canOverrideCertBlock,
  canOverrideGearRequest,
  canPrintMedicalAlerts,
  canReadCrewAwayNote,
  canReadEveryIncidentReport,
  canReadMedicalAlert,
  canReadMedicalAnswers,
  canReadMedicalClearanceDocument,
  canReadPrivateRecapPulse,
  canReadShopAnswers,
  canRefund,
  canReplyToReviews,
  canViewShopActivity,
  canViewShopReports,
  isStaff,
  type Role,
  STAFF_ROLES,
  staffDestinationGates,
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
    // H-20260724-staff-role-reach: money, legal templates, and roster deletion share the same gate.
    ["canManagePaymentSettings", canManagePaymentSettings],
    ["canRefund", canRefund],
    // H-20260724-staff-role-reach extended: raising an invoice is the same money work as refunding one.
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
    // Every answer and the physician's name on a signed record. Same wall as the
    // bulk export; every other staff role sees only the flagged prompts.
    ["canReadMedicalAnswers", canReadMedicalAnswers],
    // #1410: what a diver privately asked the shop to fix. Same boundary as the
    // physician's letter above, and promised to the diver in as many words —
    // the roster below holds the promise to the role set.
    ["canReadPrivateRecapPulse", canReadPrivateRecapPulse],
    // K2: the shop's public reply under a review speaks in the shop's name.
    ["canReplyToReviews", canReplyToReviews],
    // D5: the activity log names each staffer's own work across the team.
    ["canViewShopActivity", canViewShopActivity],
    // #2673: why a crew member is away is personal; owners and managers read it.
    ["canReadCrewAwayNote", canReadCrewAwayNote],
    // #2659: each register carries its own gate; owner and manager today, the
    // same people the Settings gate admitted before they moved out of Settings.
    ["canManageBoats", canManageBoats],
    ["canManageTripTags", canManageTripTags],
    ["canManageSafetyChecklist", canManageSafetyChecklist],
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

describe("canReadShopAnswers (every staff role)", () => {
  it("admits every staff role that can open a signed record, and nobody else", () => {
    for (const role of STAFF_ROLES) expect(canReadShopAnswers([role])).toBe(true);
    expect(canReadShopAnswers(["diver"])).toBe(false);
    expect(canReadShopAnswers([])).toBe(false);
    expect(canReadShopAnswers(undefined)).toBe(false);
  });
});

describe("canReadMedicalAlert (owner, manager, and the diver's own crew)", () => {
  const crewing = { crewsDiversDeparture: true };
  const notCrewing = { crewsDiversDeparture: false };

  it("admits the owner and a manager whether or not they crew the departure", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(canReadMedicalAlert([role], crewing)).toBe(true);
      expect(canReadMedicalAlert([role], notCrewing)).toBe(true);
    }
  });

  it("admits every other staff role only while crewing the diver's departure", () => {
    for (const role of STAFF_ROLES.filter((role) => role !== "owner" && role !== "manager")) {
      expect(canReadMedicalAlert([role], crewing)).toBe(true);
      expect(canReadMedicalAlert([role], notCrewing)).toBe(false);
    }
  });

  it("never admits a diver or nobody, even on a crew list", () => {
    expect(canReadMedicalAlert(["diver"], crewing)).toBe(false);
    expect(canReadMedicalAlert([], crewing)).toBe(false);
    expect(canReadMedicalAlert(undefined, crewing)).toBe(false);
  });
});

describe("canPrintMedicalAlerts (owner and manager, issue #2990)", () => {
  it("admits the owner and a manager", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(canPrintMedicalAlerts([role])).toBe(true);
    }
  });

  it("refuses every other staff role, a diver and nobody, crew included", () => {
    for (const role of STAFF_ROLES.filter((role) => role !== "owner" && role !== "manager")) {
      expect(canPrintMedicalAlerts([role])).toBe(false);
    }
    expect(canPrintMedicalAlerts(["diver"])).toBe(false);
    expect(canPrintMedicalAlerts([])).toBe(false);
    expect(canPrintMedicalAlerts(undefined)).toBe(false);
  });
});

describe("canEmergencyReadMedicalAlert (any staffer, on the days of the trip, issue #2990)", () => {
  const today = { window: "open" } as const;

  it("admits every staff role while the trip's days are open", () => {
    for (const role of STAFF_ROLES) {
      expect(canEmergencyReadMedicalAlert([role], today)).toBe(true);
    }
  });

  it("refuses every staff role before the trip's first day and after it is over", () => {
    for (const role of STAFF_ROLES) {
      expect(canEmergencyReadMedicalAlert([role], { window: "not_yet" })).toBe(false);
      expect(canEmergencyReadMedicalAlert([role], { window: "closed" })).toBe(false);
    }
  });

  it("never admits a diver or nobody, even on the day", () => {
    expect(canEmergencyReadMedicalAlert(["diver"], today)).toBe(false);
    expect(canEmergencyReadMedicalAlert([], today)).toBe(false);
    expect(canEmergencyReadMedicalAlert(undefined, today)).toBe(false);
  });
});

describe("canCallDayBlowout (owner/manager/captain)", () => {
  it("admits owner, manager, and captain — the people who call the weather for a whole day", () => {
    for (const role of ["owner", "manager", "captain"] as const) {
      expect(canCallDayBlowout([role])).toBe(true);
    }
  });

  it("refuses everybody else, though they may still call one departure", () => {
    for (const role of [
      "instructor",
      "assistant_instructor",
      "divemaster",
      "crew",
      "diver",
    ] as const) {
      expect(canCallDayBlowout([role])).toBe(false);
    }
    expect(canCallDayBlowout(undefined)).toBe(false);
  });
});

describe("canConfigureTrips (H-20260724-staff-role-reach — owner/manager/instructor)", () => {
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

describe("canReadEveryIncidentReport (owner or manager)", () => {
  it("admits owners and managers, and nobody who only works the water", () => {
    expect(canReadEveryIncidentReport(["owner"])).toBe(true);
    expect(canReadEveryIncidentReport(["manager"])).toBe(true);
    expect(canReadEveryIncidentReport(["captain", "manager"])).toBe(true);
    for (const role of ["instructor", "divemaster", "captain", "crew", "diver"] as const) {
      expect(canReadEveryIncidentReport([role])).toBe(false);
    }
    expect(canReadEveryIncidentReport([])).toBe(false);
    expect(canReadEveryIncidentReport(undefined)).toBe(false);
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

describe("canExportDisputeSheet (owner or manager)", () => {
  it("admits the accountable roles and nobody who runs the water", () => {
    expect(canExportDisputeSheet(["owner"])).toBe(true);
    expect(canExportDisputeSheet(["manager"])).toBe(true);
    for (const role of ["instructor", "divemaster", "captain", "crew", "diver"] as const) {
      expect(canExportDisputeSheet([role])).toBe(false);
    }
  });

  it("admits a manager who also holds an operating role, and refuses empty roles", () => {
    expect(canExportDisputeSheet(["captain", "manager"])).toBe(true);
    expect(canExportDisputeSheet([])).toBe(false);
    expect(canExportDisputeSheet(undefined)).toBe(false);
  });
});

describe("canErasePersonalData (owner only)", () => {
  it("admits only the owner: erasure is one-way, removal is the manager's tool", () => {
    expect(canErasePersonalData(["owner"])).toBe(true);
    for (const role of ALL_ROLES.filter((r) => r !== "owner")) {
      expect(canErasePersonalData([role])).toBe(false);
    }
    // Narrower than removal, which a manager may do.
    expect(canDeleteDiver(["manager"])).toBe(true);
  });

  it("admits an owner who also holds an operating role", () => {
    expect(canErasePersonalData(["captain", "owner"])).toBe(true);
  });

  it("rejects empty and undefined roles", () => {
    expect(canErasePersonalData([])).toBe(false);
    expect(canErasePersonalData(undefined)).toBe(false);
  });
});

describe("canOverrideCertBlock (owner/manager/instructor)", () => {
  it("admits the roles that set a trip's card gate, and nobody else", () => {
    for (const role of ["owner", "manager", "instructor"] as const) {
      expect(canOverrideCertBlock([role])).toBe(true);
    }
    // Narrower than the gear override: sizing a diver is not a card call.
    for (const role of ["divemaster", "captain", "crew", "diver"] as const) {
      expect(canOverrideCertBlock([role])).toBe(false);
    }
    expect(canOverrideCertBlock([])).toBe(false);
    expect(canOverrideCertBlock(undefined)).toBe(false);
  });
});

describe("canOverrideGearRequest (H-20260724-initial-gear-policy-sizing — owner/manager/instructor/divemaster)", () => {
  it("admits the in-water judgment roles, divemaster included", () => {
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
      // Distinct from `instructor`, deliberately: this map is read with
      // `includes`, so a word that is a substring of another role's word would
      // make the rung look admitted wherever the longer one is named.
      assistant_instructor: "assistant instructor",
      divemaster: "divemaster",
      captain: "captain",
      crew: "crew",
      diver: "diver",
    },
    "es-ES": {
      owner: "propietario",
      manager: "gerente",
      instructor: "instructor",
      assistant_instructor: "asistente de instructor",
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

describe("canBackfillIntegrations", () => {
  it("is the owner's alone, because it posts history into the shop's books", () => {
    expect(canBackfillIntegrations(["owner"])).toBe(true);
    expect(canBackfillIntegrations(["manager"])).toBe(false);
    expect(canBackfillIntegrations(["captain", "crew", "divemaster", "instructor"])).toBe(false);
    expect(canBackfillIntegrations(undefined)).toBe(false);
  });
});

describe("canManageBilling", () => {
  it("is the owner's alone — not a manager's, not the crew's", () => {
    expect(canManageBilling(["owner"])).toBe(true);
    expect(canManageBilling(["manager"])).toBe(false);
    expect(canManageBilling(["captain", "crew", "divemaster", "instructor"])).toBe(false);
    expect(canManageBilling(undefined)).toBe(false);
  });
});

describe("canAddDiver (every staff role)", () => {
  it("admits each staff role on its own, a captain included", () => {
    for (const role of ALL_ROLES.filter((role) => isStaff([role]))) {
      expect(canAddDiver([role])).toBe(true);
    }
  });

  it("refuses a diver, an empty role list and none at all", () => {
    expect(canAddDiver(["diver"])).toBe(false);
    expect(canAddDiver([])).toBe(false);
    expect(canAddDiver(undefined)).toBe(false);
  });
});

/**
 * #2673, security review: the away note has two readers past the person
 * themself — the staffing week (`canReadCrewAwayNote`) and the shop export,
 * which hands every note over under `canExportShopData`. Whoever may export
 * must be someone who may read the note, for every role set.
 */
describe("the crew away note's two readers", () => {
  it("never lets the export hand a note to someone the staffing week would not show it", () => {
    const sets: Role[][] = [[]];
    for (const role of ALL_ROLES) {
      for (const set of [...sets]) sets.push([...set, role]);
    }
    for (const roles of sets) {
      if (canExportShopData(roles)) expect(canReadCrewAwayNote(roles)).toBe(true);
    }
  });
});

describe("staffDestinationGates (the registers, #2659)", () => {
  it("opens boats, trip tags and the checklist to owner and manager only", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(staffDestinationGates([role])).toMatchObject({
        boats: true,
        tripTags: true,
        safetyChecklist: true,
      });
    }
    for (const role of ["instructor", "divemaster", "captain", "crew"] as const) {
      expect(staffDestinationGates([role])).toMatchObject({
        boats: false,
        tripTags: false,
        safetyChecklist: false,
      });
    }
  });

  it("hides the fleet from a shop that does not dive from a boat, and nothing else", () => {
    expect(staffDestinationGates(["owner"], { hasBoatDiving: false })).toMatchObject({
      boats: false,
      tripTags: true,
      safetyChecklist: true,
    });
  });
});
