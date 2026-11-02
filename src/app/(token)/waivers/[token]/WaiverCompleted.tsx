import Link from "next/link";
import { DiveSitesPeek } from "@/components/DiveSitesPeek";
import { EarnedMoment } from "@/components/EarnedMoment";
import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import type { TripSitePeek } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import type { DepthUnit } from "@/lib/depth-units";
import type { CompletedMedicalState } from "./completed-medical-state";
import { MedicalReviewContact } from "./MedicalReviewContact";
import { type WaiverRailProgress, WaiverStepRail, waiverRailProgress } from "./WaiverStepRail";
import { railDoneLabel, railLabels } from "./waiver-rail-copy";

/**
 * **Paperwork done**: the release this link carried is signed. What the page
 * decided about it (`medicalState`, the rail's closing frame) arrives decided;
 * this only says it. The medical hold is the page's
 * gate, kept beside the read it rests on.
 *
 * The `<main>` wears the same gutter as the signing form this diver just came
 * from: the outcome screen used to sit on a taller `py-16` on a phone than the
 * flow that led to it.
 */
export function WaiverCompleted({
  shop,
  t,
  locale,
  medicalState,
  showPrepHelp,
  readyPath = null,
  doctorPath,
  signedRail,
  diveSitesList,
  waiverOnly = false,
}: {
  shop: {
    name: string;
    contactEmail: string | null;
    contactPhone: string | null;
    depthUnit: DepthUnit;
  };
  t: DiverTranslator;
  locale: string;
  medicalState: CompletedMedicalState;
  showPrepHelp: boolean;
  /** A separately held readiness link, independently verified for this receipt. */
  readyPath?: string | null;
  /** "Take this to your doctor", while the release waits on a physician (H-20261014-physician-form-for-referral). */
  doctorPath: string | null;
  signedRail: WaiverRailProgress;
  diveSitesList: TripSitePeek[];
  waiverOnly?: boolean;
}) {
  const shopName = shop.name;
  const needsReview = medicalState !== "complete";
  const nextKey =
    medicalState === "referral"
      ? "waiver.medicalReferralNext"
      : medicalState === "form_sent"
        ? "waiver.medicalFormWaiting"
        : medicalState === "declined"
          ? "waiver.medicalDeclinedNext"
          : "waiver.medicalShopReviewNext";
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <EarnedMoment
        as="h1"
        eyebrow={shopName}
        title={
          needsReview
            ? t("capability.waiverReceived")
            : waiverOnly
              ? t("waiver.counterSigned")
              : t("capability.waiverDone")
        }
      >
        <p>{t("waiver.signedBody")}</p>
        {needsReview ? (
          <div className="mt-5 text-base" data-medical-next={medicalState}>
            <p className="font-medium">{t(nextKey)}</p>
            {medicalState === "referral" && doctorPath ? (
              <Link href={doctorPath} className={buttonClass({ className: "mt-4" })}>
                {t("waiver.doctor.open")}
              </Link>
            ) : null}
            <MedicalReviewContact shop={shop} t={t} />
          </div>
        ) : null}
        {readyPath ? (
          <Link
            href={readyPath}
            className={buttonClass({ variant: "secondary", className: "mt-5" })}
          >
            {t("waiver.seeWhatsLeft")}
          </Link>
        ) : showPrepHelp ? (
          <p className="mt-5">{t("waiver.prepLinkHelp")}</p>
        ) : null}
      </EarnedMoment>

      {/* The rail's closing frame: the same three segments the signing page
        carried. It is the only thing on this screen that answers "is that
        everything?" in the vocabulary the diver was reading two taps ago —
        the earned moment above celebrates, and a celebration is not an
        inventory. Sign settles here and only here: a typed name and a
        ticked box are not a signature until `completeWaiver` has taken
        them. Medical settles here too, *unless* the record is on a hold, in
        which case this closes at two with an open ring beside it. */}
      <WaiverStepRail
        className="mt-8"
        progress={signedRail}
        labels={railLabels(t, signedRail.questions !== null)}
        doneLabel={railDoneLabel(t, locale, signedRail.done, signedRail.total)}
      />

      <DiveSitesPeek
        sites={diveSitesList}
        heading={t("waiver.scheduledSites")}
        depthUnit={shop.depthUnit}
        t={t}
      />
    </main>
  );
}

/** A signature does not complete an unresolved medical step. */
export function completedWaiverRail(needsReview: boolean, hasShopQuestions: boolean) {
  return waiverRailProgress({
    medicalAnswered: 0,
    medicalTotal: 0,
    medicalStillOpen: needsReview,
    signed: true,
    // Questions exists only when this release version asked them.
    shopQuestions: hasShopQuestions ? { requiredRemaining: 0, reached: true } : undefined,
  });
}
