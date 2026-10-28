import type { ReactNode } from "react";
import {
  departurePaperRule,
  formatPaperDateTime,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/DeparturePaperIdentity";
import { ShopContactLinks } from "@/components/ShopContactLinks";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { courseDepthFormat } from "@/i18n/unit-labels";
import { resolveCourseContentDepths } from "@/lib/courses";
import { CourseAdmission } from "../../../courses/[slug]/_components/CourseSections";
import { ConditionsHoldSection } from "./BookingSections";
import { TripTerms } from "./TripTerms";
import type { Shop, Trip } from "./types";

export function TripPaperIdentity({
  shop,
  trip,
  locale,
  now,
}: {
  shop: Shop;
  trip: Trip;
  locale: string;
  now: Date;
}) {
  return (
    <style>
      {departurePaperRule(
        "departure-public-trip",
        [
          shop.name,
          trip.title,
          `${formatPaperDateTime(trip.startsAt, locale, shop.timezone)} · ${shop.timezone}`,
        ],
        staffTranslator(locale)("print.sheet.printed", {
          date: formatPaperDateTime(now, locale, shop.timezone),
        }),
      )}
    </style>
  );
}

export function TripPaperFacts({
  shop,
  trip,
  locale,
  t,
  inPast,
  full,
  conditionsLine,
  requirementSentence,
}: {
  shop: Shop;
  trip: Trip;
  locale: string;
  t: DiverTranslator;
  inPast: boolean;
  full: boolean;
  conditionsLine: ReactNode;
  requirementSentence: string | null;
}) {
  const paperCourse = trip.course
    ? resolveCourseContentDepths(trip.course, courseDepthFormat(t, shop.depthUnit))
    : null;
  return (
    <div data-public-trip-terms className="hidden print:block">
      {inPast || full ? (
        <p className="font-semibold">
          {t(inPast ? "booking.sailedHeading" : "booking.fullHeading")}
        </p>
      ) : null}
      {trip.conditionsHold ? <ConditionsHoldSection /> : null}
      {conditionsLine}
      {requirementSentence ? <p>{requirementSentence}</p> : null}
      {paperCourse ? (
        <CourseAdmission
          certificationRequired={
            paperCourse.minimumCertificationLevel
              ? t("course.certificationOrHigher", {
                  level: t(DIVER_CERTIFICATION_LEVEL_KEYS[paperCourse.minimumCertificationLevel]),
                })
              : t("course.noCertification")
          }
          minimumAge={paperCourse.minimumAge}
          shopNote={paperCourse.prerequisiteNote}
          t={t}
        />
      ) : null}
      <TripTerms shop={shop} trip={trip} locale={locale} />
      {shop.contactPhone || shop.contactEmail ? (
        <p className="flex flex-wrap gap-x-2">
          {t("trip.questionsContact")}
          <ShopContactLinks phone={shop.contactPhone} email={shop.contactEmail} />
        </p>
      ) : null}
    </div>
  );
}
