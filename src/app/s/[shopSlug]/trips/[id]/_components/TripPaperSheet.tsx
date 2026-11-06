import type { ReactNode } from "react";
import {
  DeparturePaperIdentity,
  formatPaperDateTime,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/DeparturePaperIdentity";
import { PaperSheet, SheetMark } from "@/components/paper/PaperSheet";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { courseDepthFormat, diveSiteDepthText } from "@/i18n/unit-labels";
import { perDiverBookingPriceCents, resolveCourseContentDepths } from "@/lib/courses";
import {
  formatDateTimeTz,
  formatDateWithYear,
  formatMoneyScanned,
  formatTimeRangeTz,
} from "@/lib/format";
import type { MinimumSeatsState } from "@/lib/minimum-seats";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { capabilityPagePrintRule, PACKET_PAPER } from "@/lib/print-sheets";
import { publicTripPath } from "@/lib/public-routes";
import { CourseAdmission } from "../../../courses/[slug]/_components/CourseSections";
import { CoursePlan, courseDayPlan, type DayProfileFacts, dayRhythmLine } from "./TripDayPlan";
import { otherSeatPriceLines } from "./TripHeader";
import { TripTerms } from "./TripTerms";
import type { DiveBriefing, Shop, Trip, TripMeetingDay } from "./types";

/** The departure's own address as paper prints it: no scheme, no query. */
function departureAddress(shopSlug: string, tripId: string): string {
  const path = publicTripPath(shopSlug, tripId);
  const origin = publicAppUrl();
  if (!origin) return path;
  return `${origin.replace(/^https?:\/\//, "").replace(/\/+$/, "")}${path}`;
}

function Rule({ children }: { children: ReactNode }) {
  return <div className="mt-5 border-t border-border pt-3">{children}</div>;
}

/**
 * **A departure on paper** (issue #2745): what the public trip page prints,
 * framed (`embed/trip/[id]`) or not. The page's screen never reaches a
 * printer: this sheet is drawn under it, shown only to the printer
 * (`data-paper-print-only`), and on paper a page holding a sheet is its
 * sheets (`globals.css`). No booking form, no control, and nothing a tap
 * would follow: the shop's number and address are words.
 *
 * It says what a diver reads before they buy, from the readers the screen
 * uses: when, with the year and the zone (paper outlives the week); what it
 * costs; whether it is full, sailed, on a hold or short of its head count;
 * what it asks of a diver; the day's dives with their depth and what to look
 * for; the conditions line; the cancellation window; and how to ask.
 *
 * **Never what the page keeps for a booked diver**: the meeting point stays
 * off, as it does on the screen (`TripHeader`'s `showMeetingPoint`), and no
 * booking, wait-list or handoff state is drawn. A page opened by one of those
 * links (`bearer`) prints with no margin, so the browser has nowhere to write
 * the link (`capabilityPagePrintRule`); every other page names its departure
 * in the margin of every page it runs to (`DeparturePaperIdentity`).
 */
export function TripPaperSheet({
  shop,
  trip,
  meetingDays,
  locale,
  t,
  now,
  status,
  minimumSeats,
  conditionsLine,
  requirementSentence,
  briefings,
  profile,
  bearer,
}: {
  shop: Shop;
  trip: Trip;
  meetingDays: readonly TripMeetingDay[];
  locale: string;
  t: DiverTranslator;
  now: Date;
  /** Whether the boat has sailed or filled; null while it still sells. */
  status: "sailed" | "full" | null;
  minimumSeats: MinimumSeatsState;
  conditionsLine: ReactNode;
  requirementSentence: string | null;
  briefings: readonly DiveBriefing[];
  profile: DayProfileFacts;
  /** The URL carries a booking, wait-list or handoff link. */
  bearer: boolean;
}) {
  const zone = shop.timezone;
  const currency = toShopCurrency(shop.currency);
  const price = perDiverBookingPriceCents(trip, trip.course);
  const otherPrices = otherSeatPriceLines(trip, currency, locale, t);
  const course = trip.course
    ? resolveCourseContentDepths(trip.course, courseDepthFormat(t, shop.depthUnit))
    : null;
  const coursePlan = courseDayPlan(profile.course, t, profile.depthUnit, profile.dayCount);
  const rhythm = dayRhythmLine(profile, briefings, t, locale, zone);
  const contact = [shop.contactPhone, shop.contactEmail].filter(Boolean).join(" · ");
  // A boat that sailed says so and nothing live: no hold, no cancellation window.
  const sailed = status === "sailed";
  const hold = trip.conditionsHold && !sailed;
  // Paper outlives the week: the stamp carries the year and names its zone.
  const asOf = t("ready.sheetAsOf", {
    when: `${formatPaperDateTime(now, locale, zone)} · ${zone}`,
  });
  const sheet = (
    <PaperSheet
      paper={PACKET_PAPER}
      band={
        <>
          <SheetMark name={shop.name} size="sm" />
          <span className="font-brand-display text-sm font-bold">{shop.name}</span>
        </>
      }
      foldLeft={asOf}
      foldRight={departureAddress(shop.slug, trip.id)}
    >
      <h1 className="font-brand-display text-xl leading-tight font-extrabold">{trip.title}</h1>
      {meetingDays.length > 1 ? (
        <ol className="mt-1 text-base">
          {meetingDays.map((day) => (
            <li key={day.id}>
              {t("trip.meetingDayLabel", {
                number: day.dayNumber,
                date: formatDateWithYear(day.startsAt, locale, zone),
                timeRange: formatTimeRangeTz(day.startsAt, day.endsAt, locale, zone),
              })}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-base">
          {formatDateWithYear(trip.startsAt, locale, zone)} ·{" "}
          {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, zone)}
        </p>
      )}
      {trip.isPrivate ? <p className="mt-1 text-sm">{t("trip.privateCharter")}</p> : null}
      {trip.course ? (
        <p className="mt-1 text-sm">
          {t("trip.courseSession")} · {trip.course.title}
        </p>
      ) : null}
      {trip.description ? <p className="mt-3 text-sm">{trip.description}</p> : null}
      {price !== null ? (
        <p className="mt-3 text-base font-semibold tabular-nums">
          {formatMoneyScanned(price, currency, locale)} {t("common.perDiver")}
        </p>
      ) : null}
      {otherPrices.length > 0 ? (
        <p className="text-sm tabular-nums">{otherPrices.map(({ line }) => line).join(" · ")}</p>
      ) : null}
      {status || hold || minimumSeats.kind === "short" || minimumSeats.kind === "due" ? (
        <Rule>
          {status ? (
            <p className="font-semibold">
              {t(sailed ? "booking.sailedHeading" : "booking.fullHeading")}
            </p>
          ) : null}
          {hold ? (
            <>
              <p className="font-semibold">{t("trip.conditionsHoldHeading")}</p>
              <p className="text-sm">{t("trip.conditionsHoldBody")}</p>
            </>
          ) : null}
          {minimumSeats.kind === "short" || minimumSeats.kind === "due" ? (
            <p className="text-sm">
              {t("trip.minimumSeatsNotice", {
                minimum: minimumSeats.minimum,
                deadline: formatDateTimeTz(minimumSeats.decidesAt, locale, zone),
              })}
            </p>
          ) : null}
        </Rule>
      ) : null}
      {requirementSentence ? (
        <Rule>
          <p className="text-sm">{requirementSentence}</p>
        </Rule>
      ) : null}
      {course ? (
        <CourseAdmission
          certificationRequired={
            course.minimumCertificationLevel
              ? t("course.certificationOrHigher", {
                  level: t(DIVER_CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
                })
              : t("course.noCertification")
          }
          minimumAge={course.minimumAge}
          shopNote={course.prerequisiteNote}
          t={t}
        />
      ) : null}
      {briefings.length > 0 || coursePlan ? (
        <Rule>
          <h2 className="font-semibold">{t("trip.theDay")}</h2>
          {rhythm ? <p className="mt-1 text-sm">{rhythm}</p> : null}
          {coursePlan ? <CoursePlan plan={coursePlan} t={t} locale={locale} /> : null}
          <ul className="mt-2 space-y-2">
            {briefings.map(({ dive, diveSite, creatures }) => {
              const depth = diveSite
                ? diveSiteDepthText(t, diveSite, shop.depthUnit, profile.readerDepthUnit ?? null)
                : null;
              const site = diveSite?.name ?? t("trip.siteToBeConfirmed");
              const names = [dive.title, site].filter(
                (name, index, all): name is string => !!name && all.indexOf(name) === index,
              );
              return (
                <li key={dive.id} className="text-sm">
                  <span className="font-semibold">
                    {t("trip.diveNumber", { number: dive.diveNumber })}
                  </span>{" "}
                  · {[...names, depth].filter(Boolean).join(" · ")}
                  {creatures.length > 0 ? (
                    <span className="block">
                      {t("trip.lookFor")}: {creatures.map((card) => card.name).join(", ")}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Rule>
      ) : null}
      <Rule>
        {conditionsLine}
        {sailed ? null : <TripTerms shop={shop} trip={trip} locale={locale} />}
      </Rule>
      {contact ? (
        <Rule>
          <p className="text-sm">
            {t("trip.questionsContact")} {contact}
          </p>
        </Rule>
      ) : null}
    </PaperSheet>
  );
  return (
    <div className="paper-sheet-frame" data-paper-print-only="">
      <div>
        {bearer ? (
          <>
            <style data-capability-print="">{capabilityPagePrintRule()}</style>
            {sheet}
          </>
        ) : (
          <DeparturePaperIdentity
            pageName="departure-public-trip"
            identity={[
              shop.name,
              trip.title,
              `${formatPaperDateTime(trip.startsAt, locale, zone)} · ${zone}`,
            ]}
            // The fold already says when; the margin says which departure.
            printed=""
          >
            {sheet}
          </DeparturePaperIdentity>
        )}
      </div>
    </div>
  );
}
