import type { ReactNode } from "react";
import { BrandStyle } from "@/components/BrandStyle";
import { PaperSheet, SheetMark } from "@/components/paper/PaperSheet";
import type { getShopById } from "@/db/shops";
import type { DoctorReferral } from "@/db/waivers";
import type { DiverTranslator } from "@/i18n/messages";
import { RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { publicAppUrl } from "@/lib/notifications";
import { PACKET_PAPER, storefrontAddress } from "@/lib/print-sheets";
import { MedicalReviewContact } from "../MedicalReviewContact";
import { SheetAnswers } from "./DoctorPaper";

/** The published form the doctor completes: its examiner page, never a restyled copy. */
const FORM = RSTC_QUESTIONNAIRE.published;

/** On paper there is no upload for "Can't send it here?" to answer. */
const offPaper = () => null;
/** On paper an address is its words. */
const asText = (chunks: ReactNode) => <span>{chunks}</span>;

export const DOCTOR_SHEET_TEST_ID = "doctor-referral-sheet";

/**
 * **The doctor's page on paper** (issue #2745): what a diver carries to the
 * clinic, as one sheet in the shop's colour.
 *
 * The diver's name, the official form to take and the page the doctor signs
 * (its public address written out, never this page's), the answers the diver
 * unlocked in this tab (`SheetAnswers`; otherwise the line saying they are not
 * included), and how the signed form gets back to the shop. Nothing on it
 * taps: no date of birth field, no upload, no link back, because none of them
 * is rendered.
 *
 * **What it never carries** (security review of layer r5-3): the waiver link.
 * The fold names the official form's edition and the storefront, the page
 * prints with no margin for the browser to write the URL in
 * (`capabilityPagePrintRule`, set by the page), and the sheet reaches paper
 * only: on screen the page is the page (`data-paper-print-only`).
 */
export function DoctorReferralSheet({
  referral,
  shop,
  t,
}: {
  referral: DoctorReferral;
  shop: NonNullable<Awaited<ReturnType<typeof getShopById>>>;
  t: DiverTranslator;
}) {
  return (
    <div className="paper-sheet-frame" data-paper-print-only="">
      <div>
        <BrandStyle brandColor={null} brandDisplayFont={shop.brandDisplayFont} />
        <PaperSheet
          paper={PACKET_PAPER}
          band={
            <>
              <SheetMark name={shop.name} size="sm" />
              <span className="font-brand-display text-sm font-bold">{shop.name}</span>
              <span className="ms-auto text-sm font-semibold">{t("waiver.doctor.title")}</span>
            </>
          }
          foldLeft={
            <span lang="en">{`${FORM.title} · ${FORM.productNumber} · ${FORM.versionDate}`}</span>
          }
          foldRight={storefrontAddress(shop.slug, publicAppUrl())}
        >
          <div data-testid={DOCTOR_SHEET_TEST_ID}>
            <p className="text-xs font-medium text-muted">{t("waiver.doctor.nameLabel")}</p>
            <p className="mt-1 border-b border-border pb-1 text-base font-semibold">
              {referral.fullName}
            </p>

            <h2 className="mt-5 text-sm font-semibold">{t("waiver.doctor.formHeading")}</h2>
            <p className="mt-2 text-sm">
              {t.rich("waiver.doctor.formBody", {
                page: FORM.examinerPage,
                title: FORM.title,
                product: FORM.productNumber,
                version: FORM.versionDate,
                form: (chunks) => <span lang="en">{chunks}</span>,
              })}
            </p>
            <p className="mt-1 break-all text-sm">{FORM.url}</p>

            <h2 className="mt-5 text-sm font-semibold">{t("waiver.doctor.answersHeading")}</h2>
            {referral.answers === "locked" ? (
              <SheetAnswers
                omitted={t("waiver.doctor.answersPrintOmitted")}
                whole={t("waiver.doctor.answersWhole")}
                note={t("waiver.doctor.answersNote")}
              />
            ) : (
              <p className="mt-2 text-sm">
                {referral.answers === "unfinished"
                  ? t("waiver.doctor.answersUnfinished")
                  : t("waiver.doctor.answersWhole")}
              </p>
            )}

            <h2 className="mt-5 text-sm font-semibold">{t("waiver.doctor.returnHeading")}</h2>
            <p className="mt-2 text-sm">
              {referral.formSent
                ? t("waiver.doctor.formSent")
                : shop.contactEmail
                  ? t.rich("waiver.doctor.returnWithEmail", {
                      emailAddress: shop.contactEmail,
                      email: asText,
                      online: offPaper,
                    })
                  : t.rich("waiver.doctor.returnToShop", { online: offPaper })}
            </p>
            <MedicalReviewContact shop={shop} t={t} paper />
          </div>
        </PaperSheet>
      </div>
    </div>
  );
}
