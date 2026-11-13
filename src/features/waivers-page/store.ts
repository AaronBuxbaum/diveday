import type { AppDb } from "../../db/client";
import { courseFormResignImpact, listCourseForms } from "../../db/course-forms";
import {
  getCurrentWaiverTemplate,
  getSignedWaiverRecordForShop,
  listWaiverIntegrityAudit,
  type SignedRecordView,
  standingWaiverExposure,
} from "../../db/waivers";

/** The page's gate and its `?view=` narrowing, from the module that reads it. */
export { canPersonManageWaiverTemplates, signedRecordViewParam } from "../../db/waivers";

/**
 * **The release setup in one wave** (issue #2757): the current release; what
 * publishing a new version would cost, in signatures, read on every render so
 * the choice can state it *before* the tap (issue #720); and the course forms
 * with what re-signing one would ask. This is Settings' page: setup only.
 */
export async function getWaiversPage(db: AppDb, shopId: string) {
  const [current, atRisk, courseForms, resign] = await Promise.all([
    getCurrentWaiverTemplate(db, shopId),
    standingWaiverExposure(db, shopId),
    listCourseForms(db, shopId),
    courseFormResignImpact(db, shopId),
  ]);
  return { current, atRisk, courseForms, resign };
}

/**
 * **The signed records in one wave**: the pinned record (`record`, already a
 * valid uuid, scoped to this shop) and the signature log's page. A non-numeric
 * `page` reads as page 1; the query clamps it into range. This is the Divers
 * area's ledger: what was signed, not how the release is written.
 */
export async function getSignedRecordsPage(
  db: AppDb,
  shopId: string,
  input: {
    record?: string | null;
    page: number;
    query: string;
    view: SignedRecordView | undefined;
  },
) {
  const [highlighted, auditPage] = await Promise.all([
    input.record ? getSignedWaiverRecordForShop(db, shopId, input.record) : null,
    listWaiverIntegrityAudit(db, shopId, {
      page: input.page,
      query: input.query,
      view: input.view,
    }),
  ]);
  return { highlighted, auditPage };
}
