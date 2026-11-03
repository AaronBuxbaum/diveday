import {
  canPersonReadMedicalAlert,
  canPersonReadMedicalAnswers,
  canPersonReadMedicalClearanceDocument,
  canPersonReadShopAnswers,
} from "./authz";
import type { AppDb } from "./client";
import { getSignedRecordShopAnswers, getSignedWaiverForDiver } from "./waivers";

/**
 * **One signed release, as this reader may see it** (issue #2757). What they
 * may read comes first, from live roles: the medical answers, the physician's
 * evaluation, the shop's own questions, and the medical alert (owner and
 * manager only here: this page has no departure whose crew the reader could be
 * on, issue #2960). Never the full questionnaire on render: it is read by
 * tapping "Show answers", whose action records the read (issue #2157). The
 * answers to the shop's own questions every staff role reads, as they read the
 * release. `null` when the record is not this diver's in this shop.
 */
export async function getSignedWaiverPage(
  db: AppDb,
  shopId: string,
  personId: string,
  recordId: string,
  readerPersonId: string,
) {
  const [readsMedicalAnswers, canOpenEvaluation, readsShopAnswers, readsMedicalAlert] =
    await Promise.all([
      canPersonReadMedicalAnswers(db, shopId, readerPersonId),
      canPersonReadMedicalClearanceDocument(db, shopId, readerPersonId),
      canPersonReadShopAnswers(db, shopId, readerPersonId),
      canPersonReadMedicalAlert(db, shopId, readerPersonId),
    ]);
  const waiver = await getSignedWaiverForDiver(db, {
    shopId,
    personId,
    recordId,
    readsMedicalAnswers,
    withholdAnswers: true,
  });
  if (!waiver) return null;
  const shopAnswers = readsShopAnswers
    ? await getSignedRecordShopAnswers(db, { shopId, personId, recordId })
    : null;
  return {
    waiver,
    shopAnswers,
    can: {
      readMedicalAnswers: readsMedicalAnswers,
      openEvaluation: canOpenEvaluation,
      readMedicalAlert: readsMedicalAlert,
    },
  };
}
