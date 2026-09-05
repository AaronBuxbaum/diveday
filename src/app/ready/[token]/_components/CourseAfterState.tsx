import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import type { CertificationLevel } from "@/lib/certification-levels";

/**
 * **What a course session leaves the student holding** (issues #1196 and
 * #1205, delight reports D36 and D45).
 *
 * Two sentences at most, and the first one is the whole point: a student
 * reading their recap after a course day learns either that the shop recorded
 * a certification, naming the level it recorded, or that it has recorded none
 * yet. **Nothing is inferred.** The reader hands over a `certification` only
 * for a card this shop issued from this departure and marked verified
 * (`src/db/recap.ts`); everything else arrives here as null and prints the
 * plainer sentence. A recap that implied a credential nobody issued would be
 * the one failure this feature could produce, so the guard is a test rather
 * than a comment (`CourseAfterState.test.tsx`).
 *
 * The second sentence is the instructor's own, printed verbatim under their
 * name — DiveDay never writes a next step, and a student with none reads
 * nothing at all rather than an empty label.
 *
 * Presentational and synchronous, with no database of its own, so its rules
 * can be pinned by a test the way the split `AfterState` already is. It sits
 * after the dive record and **before the review ask**, which stays the page's
 * single primary.
 */
export function CourseAfterState({
  t,
  courseTitle,
  shopName,
  certification,
  nextStep,
}: {
  t: DiverTranslator;
  courseTitle: string;
  shopName: string;
  /** The card this shop issued from this session, or null — never a guess. */
  certification: { level: CertificationLevel } | null;
  /** The instructor's own words, and who wrote them. */
  nextStep: { words: string; byName: string } | null;
}) {
  return (
    <section className="mt-10 print:hidden">
      <p className="text-base">
        {certification
          ? t("recap.course.certified", {
              shopName,
              level: t(DIVER_CERTIFICATION_LEVEL_KEYS[certification.level]),
            })
          : t("recap.course.notYetCertified", { course: courseTitle, shopName })}
      </p>
      {nextStep ? (
        <figure className="mt-4">
          <blockquote className="text-base leading-relaxed text-pretty">
            {t("recap.course.nextStepQuote", { words: nextStep.words })}
          </blockquote>
          <figcaption className="mt-2 text-sm text-muted">
            {t("recap.course.nextStepBy", { name: nextStep.byName })}
          </figcaption>
        </figure>
      ) : null}
    </section>
  );
}
