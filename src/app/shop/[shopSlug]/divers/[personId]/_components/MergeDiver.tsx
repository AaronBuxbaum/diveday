import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { DiverMergeCandidate, DiverMergeCandidateReason } from "@/db/diver-merge";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { displayStoredPhoneWhole } from "@/lib/forgiving-fields";
import { shopPath } from "@/lib/staff-notices";
import { MergeCandidateList } from "./MergeCandidateList";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

/** The words for why a record was offered, strongest signal first. */
export const MERGE_REASON_KEYS: Record<DiverMergeCandidateReason, StaffMessageKey> = {
  same_email: "divers.merge.sameEmail",
  same_phone: "divers.merge.samePhone",
  same_name_and_birth_date: "divers.merge.sameNameAndBirthDate",
  same_name: "divers.merge.sameName",
};

function contactLine(email: string | null, phone: string | null, missing: string): string {
  return [email, displayStoredPhoneWhole(phone)].filter(Boolean).join(" · ") || missing;
}

/**
 * **Likely duplicates of this diver**, each a door to the side-by-side merge
 * preview (`merge/[survivorId]`). Nothing merges from here: the choice of which
 * record to keep, and of which value wins where they disagree, is made on the
 * preview, with both records and everything that moves in front of the staffer.
 *
 * Renders only for an owner or manager, and only when a candidate exists; the
 * status slot stays so a refusal sent back here is still read.
 */
export function MergeDiver({
  candidates,
  shopSlug,
  personId,
  t,
  status,
}: {
  candidates: DiverMergeCandidate[];
  shopSlug: string;
  personId: string;
  t: StaffTranslator;
  status?: DiverNotice;
}) {
  if (candidates.length === 0) {
    return <DiverFormStatus status={status} className="mt-6" />;
  }
  return (
    /* Flat, per 20260827-clearwater-surface-language decision 1: the panel
       keeps its condition (it renders only when a candidate exists) and the
       reasons carry the tone. */
    <section id="merge" aria-labelledby="merge-heading" className={sectionCardClass()}>
      <h2 id="merge-heading" className={SECTION_TITLE_CLASS}>
        {t("divers.merge.heading")}
      </h2>
      <MergeCandidateList
        key={personId}
        candidates={candidates.map((candidate) => ({
          fullName: candidate.fullName,
          contact: contactLine(candidate.email, candidate.phone, t("divers.merge.noContact")),
          reasons: candidate.reasons.map((reason) => t(MERGE_REASON_KEYS[reason])).join(" · "),
          href: shopPath(shopSlug, "divers", personId, "merge", candidate.id),
          compareWith: t("divers.merge.compareWith", { name: candidate.fullName }),
        }))}
        compare={t("divers.merge.compare")}
        showMore={t("divers.merge.showMore")}
      />
      <DiverFormStatus status={status} className="mt-3" />
    </section>
  );
}
