import { listOpenRecapPulses, type OpenRecapPulse } from "@/features/recap";
import {
  countStaffReviewGroups,
  getShopReviewAggregate,
  listShopReviewsForStaff,
  MAX_BULK_PUBLISH,
  type StaffReviewNarrow,
} from "@/features/reviews";
import { canPersonManageShopSettings, canPersonReplyToReviews } from "../../db/authz";
import type { AppDb } from "../../db/client";

export { REVIEW_MODERATION_REASONS, staffReviewNarrow } from "@/features/reviews";

/**
 * The reviews worklist's question in one call: the waiting reviews (read
 * whole, up to `MAX_BULK_PUBLISH`, the ceiling on what one pass may release),
 * one page of the moderated ones, the all-time and this-month aggregates, the
 * group counts, whether this person may manage settings, and, for a pulse
 * reader only, the open private pulses.
 */
export async function getReviewsPage(
  db: AppDb,
  shopId: string,
  personId: string,
  options: {
    narrow: StaffReviewNarrow | null;
    page: number;
    monthStart: Date;
    canReadPulses: boolean;
  },
) {
  const { narrow, page, monthStart, canReadPulses } = options;
  const withCrewThanks = await canPersonReplyToReviews(db, shopId, personId);
  const [
    manageSettings,
    waitingPage,
    moderatedPage,
    aggregate,
    monthAggregate,
    groups,
    openPulses,
  ] = await Promise.all([
    canPersonManageShopSettings(db, shopId, personId),
    listShopReviewsForStaff(db, shopId, {
      scope: "waiting",
      limit: MAX_BULK_PUBLISH,
      narrow,
      withCrewThanks,
    }),
    listShopReviewsForStaff(db, shopId, { page, scope: "moderated", narrow, withCrewThanks }),
    getShopReviewAggregate(db, shopId),
    getShopReviewAggregate(db, shopId, { since: monthStart }),
    countStaffReviewGroups(db, shopId, narrow),
    canReadPulses ? listOpenRecapPulses(db, shopId) : Promise.resolve<OpenRecapPulse[]>([]),
  ]);
  return {
    can: { manageSettings },
    waitingPage,
    moderatedPage,
    aggregate,
    monthAggregate,
    groups,
    openPulses,
  };
}
