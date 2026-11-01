import {
  canPersonDeleteDiver,
  canPersonErasePersonalData,
  canPersonManageOrders,
  canPersonMergeDiver,
  canPersonOverrideGearRequest,
  canPersonReadMedicalClearanceDocument,
} from "@/db/authz";
import type { AppDb } from "@/db/client";
import { canPersonExportShopData } from "@/db/export";

/**
 * **Which of the record's controls this staffer is shown.** Hiding is a
 * courtesy, not the gate: every action re-checks the same live roles.
 *
 * Diver deletion and merging are owner/manager only (H-20260724-staff-role-reach, ADR
 * 20260724-role-authorization). Rewriting a diver's stated rental fit is
 * instructor/divemaster/manager work (H-20260724-initial-gear-policy-sizing); flagging them for hands-on fitting
 * stays open to all staff. Erasing a diver's personal and medical data is
 * stricter still: owner only, one way, and never offered to anyone else (ADR
 * 20260802-diver-data-erasure).
 */
export async function loadDiverRecordGates(db: AppDb, shopId: string, actorPersonId: string) {
  const [
    canDelete,
    canMerge,
    canOverrideFit,
    canErase,
    canExport,
    canOpenClearance,
    canManageOrders,
  ] = await Promise.all([
    canPersonDeleteDiver(db, shopId, actorPersonId),
    canPersonMergeDiver(db, shopId, actorPersonId),
    canPersonOverrideGearRequest(db, shopId, actorPersonId),
    canPersonErasePersonalData(db, shopId, actorPersonId),
    // Same owner/manager gate the shop-wide export uses (issue #726): a
    // subject-access request properly goes through the same door as the
    // shop's own copy of everything, re-checked against the database like
    // the other roles on this page.
    canPersonExportShopData(db, shopId, actorPersonId),
    // The physician's evaluation itself (issue #1283). Owner/manager, and
    // deliberately not the staff who may *record* a clearance; the reasoning
    // is at `canReadMedicalClearanceDocument`. The route re-checks the same
    // live roles before it signs anything.
    canPersonReadMedicalClearanceDocument(db, shopId, actorPersonId),
    // Raising an invoice against this diver (#1920). Three gates already stand
    // behind the link (`orders/new`'s own `allow:`, its action's re-check, and
    // `src/db/orders.ts` refusing at the write), so it was never a hole, only a
    // door a captain could not walk through. `src/db/authz.ts` states the rule
    // it broke: the UI hides the control when the permission is false, so a
    // crew member is never shown a button they will be bounced from (ADR
    // 20260724-role-authorization).
    canPersonManageOrders(db, shopId, actorPersonId),
  ]);
  return {
    canDelete,
    canMerge,
    canOverrideFit,
    canErase,
    canExport,
    canOpenClearance,
    canManageOrders,
  };
}
