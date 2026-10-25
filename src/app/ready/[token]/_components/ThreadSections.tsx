import { PackingSection } from "@/app/s/[shopSlug]/trips/[id]/_components/PackingSection";
import { TripCrewLine } from "@/app/s/[shopSlug]/trips/[id]/_components/TripCrewLine";
import { LogEntryPreview } from "@/components/LogEntryPreview";
import { TripArrivalCard } from "@/components/TripArrivalCard";
import { TripChangeLedger } from "@/components/TripChangeLedger";
import { THREAD_FOOT_SECTION_CLASS } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { ReadyPageData } from "@/db/ready";
import type { issuePartySeatClaims } from "@/db/seat-claims";
import type { getShopBySlug } from "@/db/shops";
import type { listTripChangeEvents } from "@/db/trip-change-events";
import type { getTripWithBooked, listTripDives, tripPublicCrew } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { type PlannedFlySafe, plannedFlySafeMessageKey } from "@/lib/fly-safe";
import { formatPlannedDateTimeTz, formatShortDate } from "@/lib/format";
import { publicTripArrivalCardPath } from "@/lib/public-routes";
import {
  addSeatFromReady,
  askToMoveAction,
  cancelMyBookingAction,
  payForPartySeatFromReady,
} from "../booking-actions";
import { signMinorWaiverAction } from "../party-actions";
import { CourseMaterials } from "./CourseMaterials";
import { CANCEL_PREVIEW_KEY } from "./cancel-notices";
import { MoveAsk } from "./MoveAsk";
import { PartyCancelPlan, partyCancelSeats } from "./PartyCancelPlan";
import { PartySection, partyClaimSeats } from "./PartySection";
import { RunningLate } from "./RunningLate";
import { SessionDayPlan } from "./SessionDayPlan";

/** What the thread's streamed reads hand the sections under the spine. */
export type ReadyThreadSectionsContext = {
  token: string;
  data: ReadyPageData;
  locale: DiverLocale;
  t: DiverTranslator;
  fullShop: Awaited<ReturnType<typeof getShopBySlug>>;
  fullTrip: Awaited<ReturnType<typeof getTripWithBooked>>;
  tripDives: Awaited<ReturnType<typeof listTripDives>>;
  changeEvents: Awaited<ReturnType<typeof listTripChangeEvents>>;
  publicCrew: Awaited<ReturnType<typeof tripPublicCrew>>;
  partySeatClaims: Awaited<ReturnType<typeof issuePartySeatClaims>>;
  /** "Everyone's set — see you at the dock." The rule is `partyIsAllSet`'s. */
  partyAllSet: boolean;
  /** When to fly home, as a plan (fifth-loop ideas, item 18); null when nothing honest can be said. */
  flySafePlan: PlannedFlySafe | null;
};

/**
 * The readiness thread under its spine: running late, where to go, the crew,
 * what changed, course materials, the party's section, the packing list, the
 * log entry it turns into, and last the diver's own cancel door. One `space-y-10` run, so no section
 * carries a top margin of its own (K-233).
 */
export function ThreadSections({ context }: { context: ReadyThreadSectionsContext }) {
  const {
    token,
    data,
    locale,
    t,
    fullShop,
    fullTrip,
    tripDives,
    changeEvents,
    publicCrew,
    partySeatClaims,
    partyAllSet,
    flySafePlan,
  } = context;
  const { detail } = data;
  const partySeats = partyClaimSeats(partySeatClaims);
  // Dive 1 first, in the dive plan's own order: where a site names its own
  // time in the water, that is what the day's rhythm counts rather than the
  // shop-wide default (src/lib/diver-planning.ts).
  const siteBottomTimes = tripDives.map(({ diveSite }) => diveSite?.expectedBottomTimeMinutes);
  // ...and each leg of the run between them, same order: dock to the first
  // site, then site to site (ADR 20260815-per-leg-travel-minutes). The morning
  // of a dive is when a long second leg matters most.
  const legTravelTimes = tripDives.map(({ dive }) => dive.travelMinutes);

  const cancelPreviewKey = CANCEL_PREVIEW_KEY[data.cancelPreview];
  // A lead's cancel takes their unclaimed seats with it; the confirm says
  // which go and which stay before the tap (batch 6 item 10).
  const partyCancel = partyCancelSeats(partySeatClaims);
  const hasParty = partyCancel.goes.length + partyCancel.stays.length > 0;

  return (
    <>
      {/* **One rhythm under the spine** (K-233): the sections below set no
              margin of their own, and this run spaces them 40px apart once.
              Each brought its own before — 32, 24, 24, 32, 40, 40 — so the
              column stepped unevenly down one scroll. */}
      <div className="mt-10 space-y-10">
        <RunningLate token={token} data={data} locale={locale} t={t} />
        {fullShop && fullTrip ? (
          <TripArrivalCard
            shop={{
              name: fullShop.name,
              slug: fullShop.slug,
              timezone: fullShop.timezone,
              contactPhone: fullShop.contactPhone,
              contactEmail: fullShop.contactEmail,
              address: {
                street: fullShop.addressStreet,
                locality: fullShop.addressLocality,
                region: fullShop.addressRegion,
                postalCode: fullShop.addressPostalCode,
                country: fullShop.addressCountry,
              },
            }}
            trip={fullTrip}
            locale={locale}
            // Where the day is planned to go, in the order it runs them. No
            // source chip (visual review 2026-10-24, B21): the card is the
            // shop's plan by its heading, and the ledger below is where a
            // change to it would appear, with who changed it and when.
            sites={tripDives
              .map(({ diveSite }) => diveSite?.name)
              .filter((name): name is string => Boolean(name))}
            downloadHref={`${publicTripArrivalCardPath(fullShop.slug, fullTrip.id)}?booking=${encodeURIComponent(
              token,
            )}`}
            // The thread's one map, in the one card about where to go. It used
            // to sit in a trailing "Your dive shop" card that said this card's
            // address, phone, email and map link over again.
            showMap
          />
        ) : null}
        <TripCrewLine crew={publicCrew} locale={locale} />
        <TripChangeLedger events={changeEvents} locale={locale} timeZone={detail.shop.timezone} />
        {/* A course's learning materials, the same list the confirmation
                email carried (ADR 20261008-course-learning-materials). */}
        <CourseMaterials data={data} t={t} />
        <PartySection
          locale={locale}
          seats={partySeats}
          allSet={partyAllSet}
          addSeatAction={data.canAddSeat ? addSeatFromReady.bind(null, token) : null}
          signWaiverAction={data.identityHeld ? undefined : signMinorWaiverAction.bind(null, token)}
          payAction={data.canPayPartySeats ? payForPartySeatFromReady.bind(null, token) : null}
          t={t}
        />
        {/* What to put in the bag. Below the spine — which carries the gear
                form as one of its steps — because this page's job is still "what's
                left before you sail", and this is what a diver reads once that is
                settled. The dive briefings that used to follow it are the trip
                page's "The day" list and the after-state's keepsake now: what
                you'll see down there is pitch and memory, not preparation. */}
        {fullShop && fullTrip ? (
          <PackingSection
            shop={fullShop}
            trip={fullTrip}
            rentalFit={data.rentalFit}
            // Never the "every day follows this shape" note here, even on a
            // course weekend: this page is what a diver reads the morning they
            // sail, about the day in front of them.
            multiDay={false}
            siteBottomTimes={siteBottomTimes}
            legTravelTimes={legTravelTimes}
            // This page renders no conditions card at all, so the suit line
            // has nowhere else to land — and the morning of a dive is exactly
            // when a diver is deciding what to put in the car.
            temperatureStatedAbove={false}
            holdsCertification={data.holdsCertification}
            locale={locale}
          />
        ) : null}
        {/* A course session's own afternoon, where a charter's dock-day
                rhythm stands (issue #2795). */}
        {fullShop && fullTrip ? (
          <SessionDayPlan
            course={fullTrip.course}
            meetingDays={data.meetingDayCount}
            depthUnit={fullShop.depthUnit}
            t={t}
            locale={locale}
          />
        ) : null}
        {/* When to fly home, said before the dive rather than only on the
                recap after it (fifth-loop ideas, item 18): a visitor books the
                flight before the boat sails. A sentence, not a panel, like the
                recap's: it informs and never gates. */}
        {flySafePlan ? (
          <p data-testid="ready-fly-safe-plan" className="text-base">
            {t(`ready.${plannedFlySafeMessageKey(flySafePlan.reason)}`, {
              shopName: detail.shop.name,
              when: formatPlannedDateTimeTz(flySafePlan.from, locale, detail.shop.timezone),
              count: flySafePlan.hours,
            })}
          </p>
        ) : null}
        {/* Where the day ends up (UX review 2026-10-10, item 35): the recap's
                log entry is the keepsake this same link turns into once the
                boat is home, and nothing on the page said so. One line and a
                miniature of the card, drawn from what is already true. */}
        <LogEntryPreview
          fill
          line={t("ready.logEntryWaiting")}
          date={formatShortDate(detail.trip.startsAt, locale, detail.shop.timezone)}
          siteNames={tripDives
            .map(({ diveSite }) => diveSite?.name)
            .filter((name): name is string => Boolean(name))}
          isCourse={Boolean(fullTrip?.course)}
          t={t}
        />
        {/* The diver may release their own seat; moving it is the shop's
                (ADR 20260821-the-diver-may-release-their-own-seat). It sits last,
                under everything the page is actually for, and above the shop card
                whose phone number answers every plan change this button does not.
                Rendered only when `selfCancelBooking` would actually honour it, so
                there is no control here that could only come back refused. */}
        {data.canCancelBooking ? (
          // `gap-3`, not a margin on the form: the preview renders only when
          // there is a refund to preview, and the form's own `mt-3` stood
          // "Cancel my spot" 36px under the rule without one (K-156).
          <section className={`flex flex-col gap-3 ${THREAD_FOOT_SECTION_CLASS}`}>
            {/* Past the free window, the ask comes before the forfeit (H-126). */}
            {data.moveAsk ? (
              <MoveAsk
                state={data.moveAsk}
                tripId={data.trip.id}
                locale={locale}
                timeZone={detail.shop.timezone}
                shopName={detail.shop.name}
                shopPhone={fullShop?.contactPhone ?? null}
                action={askToMoveAction.bind(null, token)}
                t={t}
              />
            ) : null}
            {cancelPreviewKey ? (
              <p className="text-base text-muted">{t(cancelPreviewKey)}</p>
            ) : null}
            <form action={cancelMyBookingAction.bind(null, token)}>
              {/* The refund preview is repeated inside the confirm rather than
                      left further up the page: the diver reads what it costs at the
                      moment of commitment, not once on the way past. */}
              <InlineConfirm
                triggerLabel={t("ready.cancelSpot")}
                triggerClassName={buttonClass({ variant: "danger", size: "sm" })}
                message={[
                  t(hasParty ? "ready.cancelConfirmParty" : "ready.cancelConfirm", {
                    trip: detail.trip.title,
                  }),
                  hasParty ? null : cancelPreviewKey ? t(cancelPreviewKey) : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                extra={
                  hasParty ? (
                    <PartyCancelPlan
                      seats={partyCancel}
                      preview={cancelPreviewKey ? t(cancelPreviewKey) : null}
                      locale={locale}
                      t={t}
                    />
                  ) : undefined
                }
                confirmLabel={t("ready.cancelConfirmButton")}
                cancelLabel={t("ready.neverMind")}
                pendingLabel={t("ready.cancelling")}
                confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
              />
            </form>
          </section>
        ) : null}
      </div>
    </>
  );
}
