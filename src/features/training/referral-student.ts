/**
 * **A referral student** (loop 5, row 10; glossary "Referral student"): a
 * course seat whose student finished theory and confined water with another
 * instructor and comes here for the open-water dives. The desk owes two
 * papers for it: the referral form the first instructor signed (`form`) and
 * the eLearning or knowledge-review record (`record`).
 *
 * Bookkeeping, never a gate: admission, readiness and the manifest never read
 * any of this, and the instructor still reads the referral form before the
 * first dive. Codes here, words in the staff bundle.
 */
export const REFERRAL_PAPERS = ["form", "record"] as const;

export type ReferralPaper = (typeof REFERRAL_PAPERS)[number];

/** Narrows an untrusted form value to one of the two papers, or null. */
export function parseReferralPaper(value: unknown): ReferralPaper | null {
  return typeof value === "string" && (REFERRAL_PAPERS as readonly string[]).includes(value)
    ? (value as ReferralPaper)
    : null;
}

/** The papers still owed for a seat, in the order the desk asks for them. */
export function referralPapersOwed(seat: {
  referredInAt: Date | null;
  referralFormAt: Date | null;
  referralRecordAt: Date | null;
}): ReferralPaper[] {
  if (!seat.referredInAt) return [];
  return REFERRAL_PAPERS.filter((paper) =>
    paper === "form" ? !seat.referralFormAt : !seat.referralRecordAt,
  );
}
