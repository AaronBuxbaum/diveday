import type { waiverRecords } from "@/db/schema";

type WaiverRecord = typeof waiverRecords.$inferSelect;

/**
 * **The release as one door may see it** (issue #4008). A counter link and a
 * mailed link to the same release can both stand, so a draft typed through
 * one (the signer's name and tick, the guardian's half, the shop answers, the
 * medical answers and alert) is shown only on the door that saved it: never a
 * guardian's tick typed at the counter on the mailed link, nor the reverse.
 * The signed fields are untouched; only the unsubmitted draft is withheld.
 */
export function recordForDoor(record: WaiverRecord, linkId: string | null): WaiverRecord {
  if (linkId !== null && record.draftViaLinkId === linkId) return record;
  return {
    ...record,
    draftSignerName: null,
    draftAcknowledged: false,
    draftMedicalAnswers: null,
    draftGuardian: null,
    draftShopAnswers: null,
    draftMedicalAlert: null,
  };
}
