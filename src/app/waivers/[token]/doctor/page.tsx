import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getDoctorReferral, getWaiverForToken } from "@/db/waivers";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { PHYSICIAN_EVALUATION_FORM as FORM, type MedicalReferralRef } from "@/lib/medical";
import { connectionForRoute } from "@/lib/observability/render-connection";
import { MedicalReviewContact } from "../MedicalReviewContact";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("waiver.doctor.title"), robots: { index: false, follow: false } };
}

// A real static shell: every request-scoped read below sits inside this
// segment's `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

function refLabel(t: DiverTranslator, ref: MedicalReferralRef): string {
  if (ref.kind === "question") return t("waiver.doctor.question", { number: ref.number });
  if (ref.kind === "box") return t("waiver.doctor.box", { box: ref.box, number: ref.number });
  return t("waiver.doctor.dental");
}

/** A line the physician writes on: a label over a rule, or a printed value. */
function FormLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="border-b border-border-strong pb-1">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 min-h-6 text-base text-foreground">{value ?? ""}</p>
    </div>
  );
}

/**
 * **Take this to your doctor** (fifth-loop ideas, item 17; H-127, ADR
 * 20261016-doctor-referral-page). A diver whose questionnaire referred them
 * opens this from their own waiver link and prints it, or shows it on their
 * phone: the examiner's evaluation form with their name and date of birth
 * filled in, the numbers of the answers that call for a physician, never the
 * answers, and how the signed page gets back to the shop.
 *
 * The waiver link is its whole authority, and it opens only while the release
 * waits on a physician; any other state goes back to the waiver page, which
 * already says each one honestly (never the 404 page, per
 * `scripts/check-capability-refusals.mjs`). Staff record the doctor's answer
 * exactly as before, from the diver's record.
 */
export default async function DoctorReferralPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connectionForRoute("/waivers/[token]/doctor");
  const { token } = await params;
  const waiverPath = `/waivers/${token}`;
  const db = await getDb();
  const state = await getWaiverForToken(db, token);
  if (state.state !== "completed") redirect(waiverPath);
  const [shop, referral] = await Promise.all([
    getShopById(db, state.record.shopId),
    getDoctorReferral(db, state.record),
  ]);
  if (!shop || !referral) redirect(waiverPath);
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  const birthdate =
    referral.dateOfBirth && isValidCalendarDate(referral.dateOfBirth)
      ? formatCalendarDate(referral.dateOfBirth, locale)
      : undefined;

  return (
    <ThreadShell
      shopName={shop.name}
      title={t("waiver.doctor.title")}
      meta={
        <p className="mt-2 text-base text-muted">{t("waiver.doctor.lede", { shop: shop.name })}</p>
      }
    >
      <div className="mt-6 flex flex-wrap items-center gap-4 print:hidden">
        <PrintButton label={t("waiver.doctor.print")} />
        <Link href={waiverPath} className="text-base text-primary hover:underline">
          {t("waiver.doctor.back")}
        </Link>
      </div>

      <section className="mt-8" aria-labelledby="doctor-answers">
        <h2 id="doctor-answers" className={SECTION_TITLE_CLASS}>
          {t("waiver.doctor.answersHeading")}
        </h2>
        {referral.refs.length > 0 ? (
          <>
            <ul className="mt-3 flex flex-wrap gap-2" data-testid="doctor-referral-refs">
              {referral.refs.map((ref) => (
                <li
                  key={refLabel(t, ref)}
                  className="rounded-md border border-border px-3 py-1 text-base text-foreground"
                >
                  {refLabel(t, ref)}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-base text-muted">{t("waiver.doctor.answersNote")}</p>
          </>
        ) : (
          <p className="mt-3 text-base text-muted">{t("waiver.doctor.answersUnfinished")}</p>
        )}
      </section>

      <section
        lang="en"
        className="mt-8 rounded-lg border border-border-strong p-5"
        aria-labelledby="doctor-form"
        data-testid="doctor-evaluation-form"
      >
        <h2 id="doctor-form" className={SECTION_TITLE_CLASS}>
          {FORM.title}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormLine label={FORM.participantName} value={referral.fullName} />
          <FormLine label={FORM.birthdate} value={birthdate} />
        </div>
        <p className="mt-4 text-sm text-foreground">{FORM.request}</p>
        <h3 className="mt-5 text-base font-semibold text-foreground">{FORM.resultHeading}</h3>
        <ul className="mt-2 flex flex-col gap-3">
          {[FORM.approved, FORM.notApproved].map((line) => (
            <li key={line} className="flex gap-3 text-sm text-foreground">
              <span
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 border border-foreground"
              />
              {line}
            </li>
          ))}
        </ul>
        <div className="mt-6 grid gap-4 sm:grid-cols-[2fr_1fr]">
          <FormLine label={FORM.signature} />
          <FormLine label={FORM.date} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {FORM.examinerFields.map((label) => (
            <FormLine key={label} label={label} />
          ))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="doctor-return">
        <h2 id="doctor-return" className={SECTION_TITLE_CLASS}>
          {t("waiver.doctor.returnHeading")}
        </h2>
        <p className="mt-3 text-base text-foreground">
          {shop.contactEmail
            ? t.rich("waiver.doctor.returnWithEmail", {
                emailAddress: shop.contactEmail,
                email: (chunks) => (
                  <a href={`mailto:${shop.contactEmail}`} className="hover:underline">
                    {chunks}
                  </a>
                ),
              })
            : t("waiver.doctor.returnToDock")}
        </p>
        <MedicalReviewContact shop={shop} t={t} />
      </section>
    </ThreadShell>
  );
}
