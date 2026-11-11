import {
  PackingLists,
  PackingSection,
} from "@/app/s/[shopSlug]/trips/[id]/_components/PackingSection";
import { TripCrewLine } from "@/app/s/[shopSlug]/trips/[id]/_components/TripCrewLine";
import { arrivalCardShopOf } from "@/components/arrival-card-facts";
import { LogEntryPreview } from "@/components/LogEntryPreview";
import { SubmitButton } from "@/components/SubmitButton";
import { TripArrivalCard } from "@/components/TripArrivalCard";
import { TripChangeLedger } from "@/components/TripChangeLedger";
import { THREAD_FOOT_SECTION_CLASS } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { getShopBySlug } from "@/db/shops";
import type { listTripChangeEvents } from "@/db/trip-change-events";
import type { getTripWithBooked, listTripDives, tripPublicCrew } from "@/db/trips";
import { type NitroxMod, nitroxPlanningLines } from "@/features/nitrox-mod";
import type { ReadyPageData } from "@/features/ready";
import type { issuePartySeatClaims } from "@/features/seat-claims";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { type PlannedFlySafe, plannedFlySafeMessageKey } from "@/lib/fly-safe";
import { formatPlannedDateTimeTz, formatShortDate } from "@/lib/format";
import { seatRentalItems } from "@/lib/participant-types";
import { publicTripArrivalCardPath } from "@/lib/public-routes";
import { nitroxAvailableOn } from "@/lib/rentals";
import {
  addSeatFromReady,
  askToMoveAction,
  cancelMyBookingAction,
  payForPartySeatFromReady,
  payFromReady,
} from "../booking-actions";
import { signMinorWaiverAction } from "../party-actions";
import { CourseMaterials } from "./CourseMaterials";
import { CANCEL_PREVIEW_KEY } from "./cancel-notices";
import { MoveAsk } from "./MoveAsk";
import { PartyCancelPlan, partyCancelSeats } from "./PartyCancelPlan";
import { PartySection, partyClaimSeats } from "./PartySection";
import { ReadyDaySheet } from "./ReadyDaySheet";
import { readyMastheadFacts } from "./ReadyMasthead";
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
  groupClaim?: { token: string } | null;
  /** "Everyone's set — see you at the dock." The rule is `partyIsAllSet`'s. */
  partyAllSet: boolean;
  /** When to fly home, as a plan (fifth-loop ideas, item 18); null when nothing honest can be said. */
  flySafePlan: PlannedFlySafe | null;
};

/**
 * The nitrox depths to plan with (loop 5, row 9), read off the page's own data
 * and never handed in: empty unless the diver asked for nitrox on this seat,
 * this seat can be given it (`nitroxAvailableOn`, the same answer as the
 * request box) and a verified card authorizes the fill (`nitroxPlanningLines`).
 */
export function readyNitroxPlan(data: ReadyPageData): NitroxMod[] {
  return nitroxPlanningLines({
    wantsNitrox: data.wantsNitrox,
    cardVerified: data.nitroxCardVerified,
    offered: nitroxAvailableOn(
      seatRentalItems(data.participantType, data.shop.rentalItems),
      data.trip.course,
    ),
  });
}

/**
 * The readiness thread under its spine: running late, where to go, the crew,
 * what changed, course materials, the party's section, the packing list, the
 * log entry it turns into, and last the diver's own cancel door. One `space-y-10` run, so no section
 * carries a top margin of its own (K-233). Under the run, the page's paper
 * (`ReadyDaySheet`): on a printer the thread is that sheet and nothing else.
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
  const nitroxPlan = readyNitroxPlan(data);
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
  const siteNames = tripDives
    .map(({ diveSite }) => diveSite?.name)
    .filter((name): name is string => Boolean(name));

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
            shop={arrivalCardShopOf(fullShop)}
            trip={fullTrip}
            locale={locale}
            // Where the day is planned to go, in the order it runs them. No
            // source chip (visual review 2026-10-24, B21): the row says
            // "Planned sites" in words. A site change is written to this
            // diver's change ledger (issue #3060), so "What changed" below
            // says when the list moved and who moved it.
            sites={siteNames}
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
        <CourseMaterials data={data} contactEmail={data.shop.contactEmail} t={t} />
        {/* A chosen hold needs a payment door even when the trip's boarding
            checklist does not require payment. Keep that safety checklist unchanged. */}
        {data.groupHoldUntil &&
        data.canPay &&
        !data.identityHeld &&
        !detail.requirement?.requiresPayment ? (
          <div className="space-y-3">
            <p className="text-base text-muted">
              {t("seatClaim.holdUntil", {
                when: formatPlannedDateTimeTz(data.groupHoldUntil, locale, detail.shop.timezone),
              })}
            </p>
            <form action={payFromReady.bind(null, token)}>
              <SubmitButton pendingLabel={t("ready.openingPayment")} className={buttonClass()}>
                {t("ready.payForTrip")}
              </SubmitButton>
            </form>
          </div>
        ) : null}
        <PartySection
          locale={locale}
          seats={partySeats}
          groupClaim={context.groupClaim}
          paymentsAtShop={data.paymentsAtShop}
          organizerSettled={data.paymentSettled}
          organizerPriceCents={data.trip.seatPriceCents}
          organizerHoldUntil={data.groupHoldUntil}
          timeZone={detail.shop.timezone}
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
        {/* The nitrox depths to plan with (loop 5, row 9), once a verified
                card backs the request. A planning aid for the briefing and the
                diver's own computer, never a fill: the tank is analyzed at the
                dock, and that mix is the one dived. */}
        {nitroxPlan.length > 0 ? (
          <section data-testid="ready-nitrox-plan" className="text-base">
            <p>{t("ready.nitroxPlan.lead")}</p>
            <ul className="mt-1">
              {nitroxPlan.map((mod) => (
                <li key={mod.o2Percent} className="tabular-nums">
                  {t("ready.nitroxPlan.line", {
                    o2: mod.o2Percent,
                    meters: mod.meters,
                    feet: mod.feet,
                  })}
                </li>
              ))}
            </ul>
            <p className="mt-1">{t("ready.nitroxPlan.stillApply")}</p>
            <p className="mt-1 text-muted">
              {t("ready.nitroxPlan.notAFill")} {t("ready.nitroxPlan.richerIsShallower")}
            </p>
          </section>
        ) : null}
        {/* Where the day ends up (UX review 2026-10-10, item 35): the recap's
                log entry is the keepsake this same link turns into once the
                boat is home, and nothing on the page said so. One line and a
                miniature of the card, drawn from what is already true. */}
        <LogEntryPreview
          fill
          line={t("ready.logEntryWaiting")}
          date={formatShortDate(detail.trip.startsAt, locale, detail.shop.timezone)}
          siteNames={siteNames}
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
            {/* Past the free window, the ask comes before the forfeit (H-20261014-ask-to-move). */}
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
                cancelLabel={t("words.dismiss.neverMind")}
                pendingLabel={t("words.busy.canceling")}
                confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
              />
            </form>
          </section>
        ) : null}
      </div>
      {/* The thread's paper: on a printer this page is this sheet alone. */}
      {fullShop && fullTrip ? (
        <ReadyDaySheet
          t={t}
          locale={locale}
          facts={readyMastheadFacts(data)}
          arrival={{ shop: arrivalCardShopOf(fullShop), trip: fullTrip }}
          sites={siteNames}
          packing={
            <PackingLists
              shop={fullShop}
              trip={fullTrip}
              rentalFit={data.rentalFit}
              holdsCertification={data.holdsCertification}
              locale={locale}
            />
          }
          asOf={nowDate()}
        />
      ) : null}
    </>
  );
}
