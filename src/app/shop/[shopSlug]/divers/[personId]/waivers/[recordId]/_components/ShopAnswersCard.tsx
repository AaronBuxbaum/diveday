import { SectionCard } from "@/components/ui/card";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { formatDateWithYear } from "@/lib/format";
import type { ShopAnswer, ShopQuestion } from "@/lib/waiver-questions";

/**
 * **"Answers to your questions"** on a signed release (glossary *Shop
 * question*), printed with the record.
 *
 * What the diver wrote, said as exactly that: DiveDay checks none of it, and
 * nothing here is evidence of fitness, age, contact or certification.
 *
 * Two lists that never mix (dive-domain reviews 1 S1, 2 S3 and S5):
 *
 * - **The sealed answers, exactly as sealed.** Each row is the snapshot's own
 *   prompt (C6), the answer or "Left blank", and, muted beneath, whether it
 *   was required and a choice's options, so the page says exactly what was
 *   asked. A `number` or `date` answer is as of the day it was signed (C9).
 * - **"Asked now, not on this release"**, under its own heading after it: the
 *   shop's current questions that the record's **own version** did not ask
 *   (`questionsNotAskedBy`, from the version's questions, never from which
 *   answers are missing). Named by the current wording, because no other
 *   exists, and said to be outside the signed record.
 *
 * A record with nothing to show in its own right says why, in one line and
 * with no list beside it: erased with the diver's personal data, held over
 * who is in the seat, imported, signed on paper (B2: nobody attested to any
 * answers there), or a version that asked questions with no answers on the
 * record (whose seal then reads invalid).
 */
export function ShopAnswersCard({
  shopAnswers,
  versionAsked,
  notOnThisRelease,
  erasedAt,
  signatureMethod,
  templateVersion,
  signedAt,
  identityHeld,
  locale,
  timezone,
  t,
}: {
  shopAnswers: readonly ShopAnswer[] | null;
  /** Whether the version this record was signed on asked any question. */
  versionAsked: boolean;
  /** The current version's questions that this record's version did not ask. */
  notOnThisRelease: readonly ShopQuestion[];
  /** When the diver's personal data was erased, or null. */
  erasedAt: Date | null;
  signatureMethod: string | null;
  templateVersion: number;
  signedAt: Date | null;
  identityHeld: boolean;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  if (!shopAnswers && !versionAsked && notOnThisRelease.length === 0) return null;
  const heading = t("waiversStaff.record.shopAnswersHeading");
  const note = erasedAt
    ? t("waiversStaff.record.shopAnswersErased", {
        date: formatDateWithYear(erasedAt, locale, timezone),
      })
    : identityHeld
      ? t("waiversStaff.record.shopAnswersHeld")
      : signatureMethod === "imported"
        ? t("waiversStaff.record.shopAnswersImported")
        : signatureMethod?.startsWith("in_person_attested")
          ? t("waiversStaff.record.shopAnswersPaper")
          : versionAsked && !shopAnswers
            ? t("waiversStaff.record.shopAnswersMissing", { version: templateVersion })
            : null;
  if (note) {
    return (
      <SectionCard title={heading}>
        <p className="text-sm text-muted">{note}</p>
      </SectionCard>
    );
  }

  const signedOn = signedAt ? formatDateWithYear(signedAt, locale, timezone) : null;
  const asOf = (answer: string) =>
    signedOn ? t("waiversStaff.record.shopAnswerAsOf", { answer, date: signedOn }) : answer;
  const sealed = (shopAnswers ?? []).map((entry) => {
    const value =
      entry.answer === null
        ? t("waiversStaff.record.shopAnswerBlank")
        : entry.kind === "yes_no"
          ? entry.answer === true
            ? t("waiversStaff.record.answerYes")
            : t("waiversStaff.record.answerNo")
          : entry.kind === "date" &&
              typeof entry.answer === "string" &&
              isValidCalendarDate(entry.answer)
            ? asOf(formatCalendarDate(entry.answer, locale))
            : entry.kind === "number"
              ? asOf(String(entry.answer))
              : String(entry.answer);
    const asked = [
      entry.required
        ? t("waiversStaff.record.shopAnswerRequired")
        : t("waiversStaff.record.shopAnswerOptional"),
      entry.kind === "choice" && entry.options?.length
        ? t("waiversStaff.record.shopAnswerOptions", { options: entry.options.join(", ") })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return { id: entry.id, label: entry.prompt, value, blank: entry.answer === null, asked };
  });

  return (
    <SectionCard
      title={heading}
      description={sealed.length > 0 ? t("waiversStaff.record.shopAnswersLead") : undefined}
    >
      {sealed.length > 0 ? (
        <dl
          className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          data-shop-answers="sealed"
        >
          {sealed.map((row) => (
            <div key={row.id} className="contents" data-shop-answer={row.id}>
              <dt className="text-muted [overflow-wrap:anywhere]">{row.label}</dt>
              <dd className="-mt-2 [overflow-wrap:anywhere] sm:mt-0">
                <span className={row.blank ? "text-muted" : "font-medium"}>{row.value}</span>
                <span className="mt-0.5 block text-xs text-muted">{row.asked}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {notOnThisRelease.length > 0 ? (
        <section
          aria-labelledby="shop-answers-not-on-release"
          className={sealed.length > 0 ? "mt-6 border-t border-border pt-4" : undefined}
          data-shop-answers="not-on-release"
        >
          <h3 id="shop-answers-not-on-release" className={ITEM_TITLE_CLASS}>
            {t("waiversStaff.record.shopAnswersNotOnRelease")}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {t("waiversStaff.record.shopAnswersNotOnReleaseLead", { version: templateVersion })}
          </p>
          <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-muted">
            {notOnThisRelease.map((question) => (
              <li key={question.id} className="[overflow-wrap:anywhere]">
                {question.prompt}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </SectionCard>
  );
}
