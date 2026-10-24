import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getDoctorReferral, getWaiverForToken } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { connectionForRoute } from "@/lib/observability/render-connection";
import { capabilityPagePrintRule } from "@/lib/print-sheets";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { MedicalReviewContact } from "../MedicalReviewContact";
import { DoctorAnswers } from "./DoctorAnswers";
import { DoctorFormUpload } from "./DoctorFormUpload";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("waiver.doctor.title"), robots: { index: false, follow: false } };
}

// A real static shell: every request-scoped read below sits inside this
// segment's `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

/** The published form the doctor completes: its examiner page, never a restyled copy. */
const FORM = RSTC_QUESTIONNAIRE.published;

/**
 * **Take this to your doctor** (fifth-loop ideas, item 17; H-127 and ADR
 * 20261016-doctor-referral-page, both amended by the layer r5-3 reviews). A
 * diver whose questionnaire referred them opens this from their own waiver
 * link and prints it: their name, the official form's examiner page to print,
 * the answers that call for a physician behind their date of birth, and how
 * the signed form gets back to the shop: sent from here, privately, or by the
 * shop's email or counter (issue #2797, ADR 20261024-diver-sent-doctors-form).
 *
 * The waiver link opens it only while the release waits on a physician and its
 * seat's departure has not ended; any other state goes back to the waiver
 * page, which already says each one honestly (never the 404 page, per
 * `scripts/check-capability-refusals.mjs`). It prints without its own URL
 * (`capabilityPagePrintRule`). Staff record the doctor's answer exactly as
 * before, from the diver's record.
 */
export default async function DoctorReferralPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connectionForRoute("/waivers/[token]/doctor");
  const { token } = await params;
  const waiverPath = `/waivers/${encodeURIComponent(token)}`;
  const db = await getDb();
  const state = await getWaiverForToken(db, token);
  if (state.state !== "completed") redirect(waiverPath);
  const [shop, referral] = await Promise.all([
    getShopById(db, state.record.shopId),
    getDoctorReferral(db, state.record),
  ]);
  if (!shop || !referral) redirect(waiverPath);
  const t = diverTranslator(await requestLocale(shop.defaultLocale));

  return (
    <ThreadShell
      shopName={shop.name}
      title={t("waiver.doctor.title")}
      meta={<p className="mt-2 text-base text-muted">{t("waiver.doctor.lede")}</p>}
    >
      {/* A fixed rule from `capabilityPagePrintRule`, never a request value. */}
      <style data-capability-print="">{capabilityPagePrintRule()}</style>
      <div className="mt-6 flex flex-wrap items-center gap-4 print:hidden">
        <PrintButton label={t("waiver.doctor.print")} />
        <Link href={waiverPath} className="text-base text-primary hover:underline">
          {t("waiver.doctor.back")}
        </Link>
      </div>

      <section
        className="mt-8 rounded-lg border border-border-strong p-5"
        aria-labelledby="doctor-form"
        data-testid="doctor-evaluation-form"
      >
        <h2 id="doctor-form" className={SECTION_TITLE_CLASS}>
          {t("waiver.doctor.formHeading")}
        </h2>
        <p className="mt-3 text-base text-foreground">
          {t.rich("waiver.doctor.formBody", {
            page: FORM.examinerPage,
            title: FORM.title,
            product: FORM.productNumber,
            version: FORM.versionDate,
            form: (chunks) => <span lang="en">{chunks}</span>,
          })}
        </p>
        <p className="mt-3">
          <a
            href={FORM.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base font-medium text-primary hover:underline print:hidden"
          >
            {t("waiver.doctor.formLink", { page: FORM.examinerPage })}
          </a>
          {/* On paper a link is its address: the form's public PDF, never this page's. */}
          <span className="hidden break-all text-sm text-foreground print:inline">{FORM.url}</span>
        </p>
        <div className="mt-5 border-b border-border-strong pb-1">
          <p className="text-xs text-muted">{t("waiver.doctor.nameLabel")}</p>
          <p className="mt-1 min-h-6 text-base text-foreground">{referral.fullName}</p>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="doctor-answers">
        <h2 id="doctor-answers" className={SECTION_TITLE_CLASS}>
          {t("waiver.doctor.answersHeading")}
        </h2>
        {referral.answers === "locked" ? (
          <DoctorAnswers
            token={token}
            copy={{
              prompt: t("waiver.doctor.answersLocked"),
              birthdate: t("waiver.doctor.birthdateLabel"),
              submit: t("waiver.doctor.unlock"),
              submitting: t("waiver.doctor.unlocking"),
              mismatch: t("waiver.doctor.unlockMismatch"),
              rate: t("waiver.doctor.unlockRate"),
              closed: t("waiver.doctor.unlockClosed"),
              whole: t("waiver.doctor.answersWhole"),
              note: t("waiver.doctor.answersNote"),
            }}
          />
        ) : (
          <p className="mt-3 text-base text-muted">
            {referral.answers === "unfinished"
              ? t("waiver.doctor.answersUnfinished")
              : t("waiver.doctor.answersWhole")}
          </p>
        )}
      </section>

      <section className="mt-8" aria-labelledby="doctor-return">
        <h2 id="doctor-return" className={SECTION_TITLE_CLASS}>
          {t("waiver.doctor.returnHeading")}
        </h2>
        {referral.formSent ? (
          <p className="mt-3 text-base text-foreground">{t("waiver.doctor.formSent")}</p>
        ) : (
          <>
            <p className="mt-3 text-base text-foreground print:hidden">
              {t("waiver.doctor.returnUpload")}
            </p>
            <DoctorFormUpload
              token={token}
              copy={{
                label: t("waiver.doctor.formLabel"),
                choose: t("waiver.doctor.formChoose"),
                chooseAnother: t("waiver.doctor.formChooseAnother"),
                submit: t("waiver.doctor.formSubmit"),
                sending: t("waiver.doctor.formSending"),
                sent: t("waiver.doctor.formSent"),
                invalid: t("waiver.doctor.formInvalid", { mb: MAX_IMAGE_MB }),
                rate: t("waiver.doctor.formRate"),
                closed: t("waiver.doctor.unlockClosed"),
                unavailable: t("waiver.doctor.formUnavailable"),
              }}
              fallback={
                <p className="mt-4 text-base text-foreground">
                  {shop.contactEmail
                    ? t.rich("waiver.doctor.returnWithEmail", {
                        emailAddress: shop.contactEmail,
                        email: (chunks) => (
                          <a href={`mailto:${shop.contactEmail}`} className="hover:underline">
                            {chunks}
                          </a>
                        ),
                      })
                    : t("waiver.doctor.returnToShop")}
                </p>
              }
            />
          </>
        )}
        <MedicalReviewContact shop={shop} t={t} />
      </section>
    </ThreadShell>
  );
}
