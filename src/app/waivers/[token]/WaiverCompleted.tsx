import Link from "next/link";
import { DiveSitesPeek } from "@/components/DiveSitesPeek";
import { EarnedMoment } from "@/components/EarnedMoment";
import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import type { TripSitePeek } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import type { DepthUnit } from "@/lib/depth-units";
import { MedicalReviewContact } from "./MedicalReviewContact";
import { type WaiverRailProgress, WaiverStepRail } from "./WaiverStepRail";
import { railDoneLabel, railLabels } from "./waiver-rail-copy";

/**
 * **Paperwork done**: the release this link carried is signed. What the page
 * decided about it (`needsReview`, the rail's closing frame, the readiness
 * link) arrives decided; this only says it. The medical hold is the page's
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
  needsReview,
  readyPath,
  doctorPath,
  signedRail,
  diveSitesList,
}: {
  shop: {
    name: string;
    contactEmail: string | null;
    contactPhone: string | null;
    depthUnit: DepthUnit;
  };
  t: DiverTranslator;
  locale: string;
  needsReview: boolean;
  readyPath: string | null;
  /** "Take this to your doctor", while the release waits on a physician (H-127). */
  doctorPath: string | null;
  signedRail: WaiverRailProgress;
  diveSitesList: TripSitePeek[];
}) {
  const shopName = shop.name;
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <EarnedMoment
        as="h1"
        eyebrow={shopName}
        title={needsReview ? t("capability.waiverReceived") : t("capability.waiverDone")}
      >
        <p>{needsReview ? t("waiver.medicalReview") : t("waiver.signedBody")}</p>
        {needsReview ? (
          <>
            {/* Corrected copy from the 2026-07-30 UX persona review (task
              44): a "yes" answer needs a *physician's* written
              clearance — the shop only receives and checks for that
              sign-off, it never grants medical clearance itself, and
              this never promises a timeline the diver's own doctor
              controls. */}
            <p className="mt-3">{t("waiver.medicalReviewNext")}</p>
            <MedicalReviewContact shop={shop} t={t} />
            {doctorPath ? (
              <Link
                href={doctorPath}
                className={buttonClass({ variant: "secondary", className: "mt-5 me-3" })}
              >
                {t("waiver.doctor.open")}
              </Link>
            ) : null}
          </>
        ) : null}
        {readyPath ? (
          <Link href={readyPath} className={buttonClass({ className: "mt-5" })}>
            {t("waiver.seeWhatsLeft")}
          </Link>
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
        labels={railLabels(t)}
        doneLabel={railDoneLabel(t, locale, signedRail.done)}
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
