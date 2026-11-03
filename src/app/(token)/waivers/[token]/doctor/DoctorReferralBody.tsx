import Link from "next/link";
import type { ReactNode } from "react";
import { PrintButton } from "@/components/PrintButton";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { getShopById } from "@/db/shops";
import type { DoctorReferral } from "@/db/waivers";
import type { DiverTranslator } from "@/i18n/messages";
import { RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { capabilityPagePrintRule } from "@/lib/print-sheets";
import { MAX_IMAGE_MB } from "@/lib/storage";
import { MedicalReviewContact } from "../MedicalReviewContact";
import { DoctorAnswers } from "./DoctorAnswers";
import { DoctorFormUpload } from "./DoctorFormUpload";
import type { DoctorAnswersState, DoctorFormState } from "./doctor-core";

/** The published form the doctor completes: its examiner page, never a restyled copy. */
const FORM = RSTC_QUESTIONNAIRE.published;

/** The "Can't send it here?" lead-in: on paper there is no upload for it to answer. */
const onlineOnly = (chunks: ReactNode) => <span className="print:hidden">{chunks}</span>;

/**
 * **The doctor's page, whichever door opened it** (issue #2743): the waiver
 * link's `/waivers/<token>/doctor` and the diver's thread's
 * `/ready/<token>/waiver/doctor` draw exactly this, each with its own actions
 * and its own way back.
 */
export function DoctorReferralBody({
  referral,
  shop,
  t,
  backPath,
  revealAction,
  sendAction,
}: {
  referral: DoctorReferral;
  shop: NonNullable<Awaited<ReturnType<typeof getShopById>>>;
  t: DiverTranslator;
  backPath: string;
  revealAction: (previous: DoctorAnswersState, formData: FormData) => Promise<DoctorAnswersState>;
  sendAction: (previous: DoctorFormState, formData: FormData) => Promise<DoctorFormState>;
}) {
  return (
    <ThreadShell
      shopName={shop.name}
      title={t("waiver.doctor.title")}
      meta={<p className="mt-2 text-base text-muted">{t("waiver.doctor.lede")}</p>}
    >
      {/* A fixed rule from `capabilityPagePrintRule`, never a request value. */}
      <style data-capability-print="">{capabilityPagePrintRule()}</style>

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
            className={buttonClass({ className: "print:hidden" })}
          >
            {t("waiver.doctor.formLink")}
          </a>
          {/* On paper a link is its address: the form's public PDF, never this page's. */}
          <span className="hidden break-all text-sm text-foreground print:inline">{FORM.url}</span>
        </p>
        <div className="mt-5 border-b border-border-strong pb-1">
          <p className="text-xs text-muted">{t("waiver.doctor.nameLabel")}</p>
          <p className="mt-1 min-h-6 text-base text-foreground">{referral.fullName}</p>
        </div>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-4 print:hidden">
        <PrintButton label={t("waiver.doctor.print")} />
        <Link
          href={backPath}
          className={`${tapTargetLinkClass} text-base text-primary hover:underline`}
        >
          {t("waiver.doctor.back")}
        </Link>
      </div>

      <section className="mt-8" aria-labelledby="doctor-answers">
        <h2 id="doctor-answers" className={SECTION_TITLE_CLASS}>
          {t("waiver.doctor.answersHeading")}
        </h2>
        {referral.answers === "locked" ? (
          <DoctorAnswers
            action={revealAction}
            copy={{
              prompt: t("waiver.doctor.answersLocked"),
              printOmitted: t("waiver.doctor.answersPrintOmitted"),
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
              action={sendAction}
              copy={{
                label: t("waiver.doctor.formLabel"),
                choose: t("waiver.doctor.formChoose"),
                chooseAnother: t("waiver.doctor.formChooseAnother"),
                submit: t("waiver.doctor.formSubmit"),
                sending: t("words.busy.sending"),
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
                        online: onlineOnly,
                      })
                    : t.rich("waiver.doctor.returnToShop", { online: onlineOnly })}
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
