import { SectionCard } from "@/components/ui/card";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { formatDateWithYear } from "@/lib/format";
import type { ShopAnswer, ShopQuestion } from "@/lib/waiver-questions";

/** One line of the card: the label it shows, and what stands beside it. */
type AnswerRow = { id: string; label: string; value: string; muted: boolean };

/**
 * **"Answers to your questions"** on a signed release (glossary *Shop
 * question*), printed with the record.
 *
 * What the diver wrote, said as exactly that: DiveDay checks none of it, and
 * nothing here is evidence of fitness, age, contact or certification. Three
 * states, never confused (dive-domain review C5): answered, left blank, and
 * **not asked**, for a question the shop's current version asks that the
 * version this release was signed on did not. A `date` or `number` answer is
 * as of the day it was signed, because "dives logged: 40" from last January
 * understates by a season (C9). The snapshot's own prompt is the only label an
 * answer wears (C6); a question never asked can only be named by the current
 * version's.
 *
 * A paper or imported release records no answers, and the card says so rather
 * than claiming they are "on the paper" (B2): nobody attested to them.
 */
export function ShopAnswersCard({
  shopAnswers,
  currentQuestions,
  signatureMethod,
  templateVersion,
  signedAt,
  identityHeld,
  locale,
  timezone,
  t,
}: {
  shopAnswers: readonly ShopAnswer[] | null;
  currentQuestions: readonly ShopQuestion[];
  signatureMethod: string | null;
  templateVersion: number;
  signedAt: Date | null;
  identityHeld: boolean;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  if (!shopAnswers && currentQuestions.length === 0) return null;
  const heading = t("waiversStaff.record.shopAnswersHeading");
  const note = identityHeld
    ? t("waiversStaff.record.shopAnswersHeld")
    : signatureMethod === "imported"
      ? t("waiversStaff.record.shopAnswersImported")
      : signatureMethod?.startsWith("in_person_attested")
        ? t("waiversStaff.record.shopAnswersPaper")
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
  const asked = shopAnswers ?? [];
  const rows: AnswerRow[] = asked.map((entry) => {
    if (entry.answer === null) {
      return {
        id: entry.id,
        label: entry.prompt,
        value: t("waiversStaff.record.shopAnswerBlank"),
        muted: true,
      };
    }
    const value =
      entry.kind === "yes_no"
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
    return { id: entry.id, label: entry.prompt, value, muted: false };
  });
  const askedIds = new Set(asked.map((entry) => entry.id));
  for (const question of currentQuestions) {
    if (askedIds.has(question.id)) continue;
    rows.push({
      id: question.id,
      label: question.prompt,
      value: t("waiversStaff.record.shopAnswerNotAsked", { version: templateVersion }),
      muted: true,
    });
  }

  return (
    <SectionCard title={heading} description={t("waiversStaff.record.shopAnswersLead")}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {rows.map((row) => (
          <div key={row.id} className="contents" data-shop-answer={row.id}>
            <dt className="text-muted [overflow-wrap:anywhere]">{row.label}</dt>
            <dd
              className={`-mt-2 [overflow-wrap:anywhere] sm:mt-0 ${row.muted ? "text-muted" : "font-medium"}`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
