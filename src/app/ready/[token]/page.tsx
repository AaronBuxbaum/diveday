import type { Metadata } from "next";
import { Suspense } from "react";
import { AfterState } from "@/app/ready/[token]/_components/AfterState";
import { readyAfterStateProps } from "@/app/ready/[token]/_components/after-state-actions";
import { BoatStageLine } from "@/app/ready/[token]/_components/BoatStageLine";
import { cancelledNoticeForReady } from "@/app/ready/[token]/_components/CancelledNotice";
import { CertificationEntries } from "@/app/ready/[token]/_components/CertificationEntries";
import { ChangedFacts, fitRecallFrom } from "@/app/ready/[token]/_components/ChangedFacts";
import { CourseNextStepNote } from "@/app/ready/[token]/_components/CourseNextStepNote";
import { DayOfDetails } from "@/app/ready/[token]/_components/DayOfDetails";
import { readyDeadLink } from "@/app/ready/[token]/_components/dead-link";
import { PayStepBody } from "@/app/ready/[token]/_components/PayStepBody";
import { atShopMoneyLine, payStepLines } from "@/app/ready/[token]/_components/pay-step-lines";
import { resolvePaymentReceipt } from "@/app/ready/[token]/_components/payment-receipt";
import { ReadyFitForm } from "@/app/ready/[token]/_components/ReadyFitForm";
import { ReadyBookedPage, ReadyMastheadMeta } from "@/app/ready/[token]/_components/ReadyMasthead";
import { ReadyOfflineCopy } from "@/app/ready/[token]/_components/ReadyOfflineCopy";
import { ReadyThreadBodySkeleton } from "@/app/ready/[token]/_components/ReadyThreadBodySkeleton";
import { READY_NOTICES } from "@/app/ready/[token]/_components/ready-notices";
import { readyOfflineWords } from "@/app/ready/[token]/_components/ready-offline-words";
import { SignStepActions } from "@/app/ready/[token]/_components/SignStepActions";
import { ThreadSections } from "@/app/ready/[token]/_components/ThreadSections";
import {
  ThreadSpine,
  ThreadStatus,
  threadSpineSteps,
} from "@/app/ready/[token]/_components/ThreadSpine";
import {
  boatStageLine,
  readyStepLine,
  readyThreadFacts,
} from "@/app/ready/[token]/_components/thread-facts";
import { YourDays } from "@/app/ready/[token]/_components/YourDays";
import { FlashParams } from "@/components/FlashParams";
import { RecapWaitingCard } from "@/components/RecapWaitingCard";
import { RememberBooker } from "@/components/RememberBooker";
import { ShopNotice } from "@/components/ShopPageHeader";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { type AppDb, getDb } from "@/db/client";
import { getCourseFormsForBooking } from "@/db/course-forms";
import { diverCrewWithAway } from "@/db/crew-away-diver";
import { packageDivesForBooking } from "@/db/dive-packages";
import { readPlannedFlySafe } from "@/db/fly-safe-plan";
import { getBookedCard, getReadyPageData } from "@/db/ready";
import { issuePartySeatClaims } from "@/db/seat-claims";
import { getShopBySlug } from "@/db/shops";
import { listTripChangeEvents } from "@/db/trip-change-events";
import { latestTripStage } from "@/db/trip-stages";
import { getTripWithBookedOnce, listTripDives } from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { checklistDetailText } from "@/i18n/readiness-summary-labels";
import { requestLocale } from "@/i18n/request";
import { threadNextKey } from "@/i18n/thread-labels";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { connectionForRoute } from "@/lib/observability/render-connection";
import { seatRentalItems } from "@/lib/participant-types";
import { readyCopyKeepUntil } from "@/lib/ready-offline";
import { nitroxAvailableOn } from "@/lib/rentals";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import {
  buildThreadSteps,
  isDiveDay,
  partyIsAllSet,
  type ThreadStep,
  theBoatIsHome,
} from "@/lib/thread-steps";
import { HeldAfterDiveCard, NoShowCard, releasedSeat } from "./_components/AfterDiveDoors";
import { readAfterTheDive } from "./_components/after-dive-reads";
import { UnavailableReadyLink } from "./_components/ExpiredLink";
import { confirmCarriedFactsFromReady, saveTanksFromReady } from "./gear-actions";
import { saveEmergencyContactFromReady } from "./paperwork-actions";
import { terminalCardIn } from "./terminal-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("ready.metaTitle"),
    robots: { index: false, follow: false },
  };
}

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function ReadyTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    pay?: string;
    cancelled?: string;
    booked?: string;
    sent?: string;
  }>;
}) {
  await connectionForRoute("/ready/[token]");
  const { token } = await params;
  const { saved, error, pay, cancelled, booked, sent } = await searchParams;
  // A seat was taken in the request that redirected here — this page is the
  // one page after booking now (ADR 20260820-one-page-after-booking). It
  // switches the celebration from "you're ready" to "you're booked" and turns
  // on the two lines that are only ever true in the minutes after a submit.
  //
  // It carries no claim of its own and authorizes nothing: the payment
  // receipt, the checklist, and every other fact on this page are read from
  // the booking, so a hand-edited `?booked=1` moves nothing but which of two
  // congratulations renders.
  const justBooked = booked === "1";
  const db = await getDb();
  // A dead link resolves no shop, so there is no `shops.default_locale` to fall
  // back to — negotiate from the visitor's own device alone for those branches,
  // then re-negotiate below once the shop is known.
  const anonT = diverTranslator(await requestLocale());
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) {
    return readyDeadLink({ db, token, cancelled, sent, error, anonT });
  }
  const { bookingId, shopId: capabilityShopId, delivered } = capability;

  /**
   * **The booked card in the first paint** (UX review 2026-10-10, items 7 and
   * 34). Straight after a booking POST the diver used to land on this route's
   * whole-page skeleton until the full loader had read the departure's entire
   * readiness roster, at the one moment they were waiting to be told it
   * worked. The card needs one row: `getBookedCard` reads it, the card paints,
   * and everything else streams in under it behind the thread's own skeleton.
   * Only while the card would be true: a seat or departure already gone, or a
   * boat already home, falls through to the full path, which owns those cards.
   * Never gated on readiness: the card claims a seat, never boarding (see
   * `getBookedCard`), and a held diver reads the hold in the thread under it.
   */
  const found = justBooked
    ? await getBookedCard(db, { shopId: capabilityShopId, bookingId, delivered })
    : null;
  const card =
    found && !found.bookingCancelled && !found.departureCancelled && !theBoatIsHome(found.trip)
      ? found
      : null;
  const thread = (
    <DiverReadinessPage
      db={db}
      token={token}
      bookingId={bookingId}
      delivered={delivered}
      search={{ saved, error, pay, justBooked }}
      anonT={anonT}
      underBookedHeader={card !== null}
    />
  );
  if (!card) return thread;
  return (
    <ReadyBookedPage card={card} locale={await requestLocale(card.shop.defaultLocale)}>
      <Suspense fallback={<ReadyThreadBodySkeleton />}>{thread}</Suspense>
    </ReadyBookedPage>
  );
}

/**
 * The page for a verified booking: the full loader, the terminal cards a
 * cancelled seat or a finished day gets, and the thread.
 *
 * `underBookedHeader` is the booked fast path above: the card, the shell and
 * the provider have already painted, so this renders only what sits under
 * them. The fast path declines whenever a terminal card could apply, so in
 * that mode those branches are reached only by a race with a staff cancel.
 */
async function DiverReadinessPage({
  db,
  token,
  bookingId,
  delivered,
  search: { saved, error, pay, justBooked },
  anonT,
  underBookedHeader,
}: {
  db: AppDb;
  token: string;
  bookingId: string;
  delivered: boolean;
  search: { saved?: string; error?: string; pay?: string; justBooked: boolean };
  anonT: DiverTranslator;
  underBookedHeader: boolean;
}) {
  const alone = terminalCardIn(underBookedHeader, token);
  const data = await getReadyPageData(db, bookingId);
  // `ready.unavailableBody`, not the waiver subtree's identical sentence
  // (issue #1334): `/waivers` and `/ready` have different rescues, and a
  // reword of one should not reach the other by accident.
  if (!data) return alone(<UnavailableReadyLink t={anonT} />);

  const { detail, shop, person } = data;
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  const yourDays = (
    <YourDays ready={{ db, token, bookingId, data, delivered }} locale={locale} t={t} />
  );

  if (detail.cancelled) {
    // The shop took this seat off the boat and this diver still holds a live
    // link: the read above won a race against the capability revoke. Rare, and
    // the one path a diver learns from this page, not the shop. Money is read
    // from the payment row. `alone(null)` is the exit under the booked header.
    return alone(null) ?? cancelledNoticeForReady(db, data, bookingId, locale, t);
  }

  /**
   * The shop's own published identity, in the shape the terminal notices below
   * hand to `ExpiredLinkCard`. A live token has already resolved the shop, and
   * a diver holding a phone on a day that went wrong needs somebody to ask
   * (issue #801).
   */
  const { contactEmail, contactPhone } = shop;
  const shopContact = { name: detail.shop.name, contactEmail, contactPhone };

  /**
   * **After the dive, the same link** (ADR 20260827-the-divers-thread,
   * decision 4). Once this diver's day is over, everything below this point —
   * the spine, the packing list, the self-cancel door — is about a day that
   * has already happened. The page becomes the afterglow instead: the
   * keepsake, one review ask, and quiet doors. `/recap/[token]` renders
   * exactly this, from its own token.
   *
   * **Whose day, not just what time it is.** The switch used to be the clock
   * alone, and the clock cannot tell whether this diver was on the boat — so
   * the crew's own departure roll call decides it wherever a shop kept one,
   * and the four-hour recap floor decides it where none exists
   * (`readAfterTheDive`, beside this page). The read only happens once the
   * boat is scheduled home, so an ordinary night-before page load never pays
   * for it.
   *
   * The three recap actions are bound to a **recap** token minted here, never
   * to this page's readiness token: the two capabilities are domain-separated
   * on purpose (`src/lib/recap-links.ts`), and widening the recap actions to
   * accept a readiness token would hand a review form the power to cancel a
   * booking. The cost is that acting on one of them lands the diver on the
   * `/recap` URL, which renders this same surface.
   */
  const afterDive = await readAfterTheDive(db, {
    shopId: shop.id,
    tripId: detail.trip.id,
    endsAt: detail.trip.endsAt,
    bookingId,
    identityHeld: data.identityHeld,
  });
  if (afterDive.afterTheDive) {
    if (data.identityHeld) return alone(<HeldAfterDiveCard shop={shopContact} t={t} />);
    const recapState = await afterDive.recap();
    if (recapState.kind === "waiting") return alone(<RecapWaitingCard shop={shopContact} t={t} />);
    const recap = recapState.kind === "recap" ? recapState.data : null;
    if (!recap) return alone(<NoShowCard shop={shopContact} t={t} turnedAway={data.turnedAway} />);
    const after = await readyAfterStateProps({
      db,
      data: recap,
      bookingId,
      locale,
      t,
      token,
      delivered,
    });
    return alone(
      <DiverIntlProvider
        locale={locale}
        timeZone={detail.shop.timezone}
        namespaces={["recap", "common", "booking", "reviews", "trip"]}
      >
        <AfterState context={{ ...after, yourDays }} />
      </DiverIntlProvider>,
    );
  }
  if (data.seatReleased) return releasedSeat(db, shop.id, bookingId, locale, shopContact, t);

  const notice = noticeFromParam(
    saved ? `saved-${saved}` : error ? `error-${error}` : pay ? `pay-${pay}` : undefined,
    READY_NOTICES,
  );

  /**
   * The departure is today. From 00:00 in the shop's own zone, not twenty-four
   * hours out: the night before, this page is a plan; on the day it is a
   * morning, and the dock call is the only number on it that matters.
   */
  const diveDay = isDiveDay({
    startsAt: detail.trip.startsAt,
    endsAt: detail.trip.endsAt,
    timeZone: detail.shop.timezone,
  });

  /**
   * The thread below the confirmation, as one promise the page hands to a
   * `<Suspense>` boundary rather than awaits (UX audit #5): a diver who has
   * just booked sees their seat confirmed while these reads are still in
   * flight. A Server Component renders a promise child as soon as it settles.
   * It reads nothing the masthead does not already hold authority for: the
   * same verified `bookingId`, the same shop scope.
   */
  const threadBody = (async () => {
    // The trip itself, as the public trip page reads it.
    //
    // This page used to carry a five-line header and a thumbnail strip of site
    // names, so a diver who arrived here from the confirmation email — the link
    // the shop actually sends the night before — could not see which site each
    // tank was on, or what to put in the bag, without going and finding the
    // public trip page (2026-08-06 review). Its own sections stay what they were:
    // this adds the two the page had no answer for at all, and drops the site
    // *peek*, which the briefings below say properly.
    //
    // Read here in the page, not in a layout: `instant = true` holds because
    // every one of these sits inside this segment's own `loading.tsx` boundary
    // (ADR 20260804-instant-navigation).
    // One round trip, not two: the trip reads are scoped by `shop.id`, which the
    // verified capability already resolved, so none of them has to wait on the
    // shop row `PackingSection` needs for its units and rental catalogue.
    const threadTripReads = Promise.all([
      getShopBySlug(db, shop.slug),
      getTripWithBookedOnce(db, shop.id, data.trip.id),
      listTripDives(db, shop.id, data.trip.id),
      listTripChangeEvents(db, shop.id, data.trip.id),
      // The crew who agreed to be named (issue #1181, D21), the same filter as
      // the public page, each marked away on this departure's days (item 12).
      diverCrewWithAway(db, shop.id, detail.trip, detail.shop.timezone),
      // Where the crew last said this boat was (ADR
      // 20260904-reef-all-the-way-down, Budget rule 4). Read whatever its age;
      // `liveStageOf` below decides whether it still speaks, so a stage nobody
      // cleared cannot follow a diver into next week.
      latestTripStage(db, shop.id, data.trip.id),
    ]);
    // The organizer's claim panel, when this booking leads a party (docs ADR
    // 20260804-seat-claim-links): the readiness link is the durable one from
    // the confirmation email, so "who still hasn't claimed?" has an answer the
    // night before, not only in the minutes after booking. Authorized by the
    // verified `readiness` capability above; the query only ever walks seats
    // led by this booking, so a member's own /ready renders no panel. One wave with
    // the rest: each needs only the verified booking, shop and person (review 2026-10-11).
    const [partySeatClaims, tripReads, paymentReceipt, courseForms, packageDives, flySafePlan] =
      await Promise.all([
        issuePartySeatClaims(db, { shopId: shop.id, leadBookingId: bookingId }),
        threadTripReads,
        // What this booking has been charged. Read on every visit, because "what did
        // I pay?" is a question the night before too — and it is what the Pay step's
        // settled line says, now that the receipt panel that used to say it above
        // the checklist is gone (ADR 20260827-the-divers-thread, decision 3).
        // The emails line went with that panel; `EmbedBookedNotice` still carries it,
        // where it is the only thing the reader gets.
        resolvePaymentReceipt(
          db,
          shop.id,
          bookingId,
          // The two ways a diver arrives here straight off Stripe's hosted page:
          // paying at booking (`bookSpot`'s success_url) and paying later
          // (`payFromReady`'s). Both are the moment the webhook may still be in
          // flight; every other arrival is not.
          justBooked || pay === "paid",
          data.trip.seatPriceCents,
          toShopCurrency(shop.currency),
        ),
        // Asked whatever `COURSE_FORMS_BLOCK_BOARDING` says: warn-only raises no blocker (#2266).
        data.asksCourseForms ? getCourseFormsForBooking(db, shop.id, bookingId) : null,
        packageDivesForBooking(db, { shopId: shop.id, personId: data.person.id, bookingId }),
        // When to fly home, as a plan, before the boat sails (fifth-loop ideas, item 18).
        readPlannedFlySafe(db, data),
      ]);
    const [fullShop, fullTrip, tripDives, changeEvents, publicCrew, boatStage] = tripReads;
    const courseFormsOwed = (courseForms?.outstanding.length ?? 0) > 0;

    const stageLine = boatStageLine(boatStage, detail.trip, detail.shop.timezone, locale, t);

    const facts = readyThreadFacts(data, Boolean(fullTrip), locale);
    const { items, hasRentalFit, hasLastDived, nitroxCardEntryOffered, carriedFacts } = facts;

    /**
     * **The spine** (ADR 20260827-the-divers-thread, decision 3). Every step it
     * emits is finishable, so the figure over it can always fill — which is the
     * whole reason the optional questions (the note, hotel pickup) live
     * *inside* Day-of details rather than beside it as rows of their
     * own that moved no number when answered.
     */
    const spine = buildThreadSteps({
      checklist: items,
      // Money is owed, or money has settled. The receipt matters on its own:
      // a departure whose requirement does not gate on payment can still have
      // taken a card at booking, and that payment has to render somewhere.
      hasPayableOrder: items.some((item) => item.category === "payment") || paymentReceipt !== null,
      rentalFitComplete: hasRentalFit,
      dayOfComplete: hasLastDived,
      carriedFacts,
      carriedFactsConfirmed: data.carriedFactsConfirmedAt != null,
      participantType: data.participantType,
      courseFormsOwed,
    });

    /** "Everyone's set — see you at the dock." The rule is `partyIsAllSet`'s. */
    const currentStep = spine.steps.find((step) => step.id === spine.current);
    const partyAllSet = partyIsAllSet({
      seats: partySeatClaims,
      ownSignSettled: (spine.steps.find((step) => step.id === "sign")?.state ?? "done") === "done",
      diveDay,
    });

    /** A money figure in the currency it was actually charged in, never today's shop setting. */
    const money = (cents: number, currency: string) => formatMoneyCents(cents, currency, locale);
    const paid = payStepLines(t, money, paymentReceipt, packageDives, data.shop.deskPayment);

    // What is owed at the shop, said once (fourth UX review, item 5).
    const atShopLine = atShopMoneyLine(t, locale, shop.currency, data, fullTrip, partySeatClaims);

    /** One step's fact, and one step's form. The two things the spine cannot derive. */
    const stepLine = (step: ThreadStep): string | null =>
      readyStepLine(step, { t, facts, lastDivedBand: data.lastDivedBand, paidLine: paid.paidLine });

    /**
     * The step's form, or nothing.
     *
     * A settled step returns nothing and renders as a line — with two deliberate
     * exceptions, gear and Day-of, whose answers a diver genuinely revisits (a
     * fin size the night before, a recency band they mistyped). Those stay
     * openable, and "collapses to a check line" is what their closed summary
     * already is.
     */
    // What this seat may rent: a snorkeler sees surface kit only, so no nitrox or
    // tanks either (ADR 20261007-participant-types; a rider has no gear step).
    const seatItems = seatRentalItems(data.participantType, data.shop.rentalItems);
    /**
     * The sizes form, composed once and opened from either spelling of its step:
     * as the whole of `gear`, or behind the Sizes door of `changes`. One node so
     * the two can never drift into asking for sizes differently — and so the
     * "Change" door opens the form that already owns every size column and posts
     * all of them, rather than a partial that would blank what it did not carry.
     */
    const fitForm = (
      <ReadyFitForm
        token={token}
        data={data}
        seatItems={seatItems}
        nitroxCardEntryOffered={nitroxCardEntryOffered}
        saved={saved === "fit"}
      />
    );

    const fitRecall = fitRecallFrom(data);

    const stepBody = (step: ThreadStep): React.ReactNode => {
      // Every step's one action is the primary button (visual review
      // 2026-10-24, B26): only one step is open at rest, so the page still
      // shows one, and a step opened by hand reads as the act it is.
      const actionButton = buttonClass({ variant: "primary" });
      switch (step.id) {
        case "sign":
          return (
            <SignStepActions
              token={token}
              item={step.item}
              courseFormsOwed={courseFormsOwed}
              actionButton={actionButton}
              t={t}
            />
          );
        case "certification":
          if (!step.item) return null;
          return (
            <CertificationEntries
              token={token}
              item={step.item}
              offerNitrox={nitroxCardEntryOffered}
              notYet={data.certificationNotYet}
              t={t}
            />
          );
        case "pay": {
          const payable =
            data.canPay &&
            (step.item?.code === "payment_due" || step.item?.code === "payment_refunded");
          if (!payable && !paid.depositBalanceLine) return null;
          return (
            <PayStepBody
              token={token}
              payable={payable}
              depositBalanceLine={paid.depositBalanceLine}
              actionButton={actionButton}
              fullShop={fullShop}
              fullTrip={fullTrip}
              locale={locale}
              t={t}
            />
          );
        }
        case "gear":
          return fitForm;
        case "changes":
          return (
            <ChangedFacts
              t={t}
              locale={locale}
              fit={data.rentalFit}
              wantsNitrox={data.wantsNitrox}
              // Re-derived here, not read off the fit form: the tanks row may only
              // ask what the shop can actually answer.
              offerNitrox={nitroxAvailableOn(seatItems, data.trip.course)}
              emergencyContact={data.emergencyContact}
              fitRecall={fitRecall}
              fitForm={fitForm}
              actions={{
                confirm: confirmCarriedFactsFromReady.bind(null, token),
                saveTanks: saveTanksFromReady.bind(null, token),
                saveContact: saveEmergencyContactFromReady.bind(null, token),
              }}
            />
          );
        case "dayof":
          return <DayOfDetails token={token} data={data} saved={saved === "day-of"} t={t} />;
      }
    };

    const spineSteps = threadSpineSteps(spine, t, stepLine, stepBody);

    return (
      <>
        {spine.setupItem ? (
          // Nothing on this booking is the diver's until the shop finishes its
          // own configuration, so there is no spine and no figure — one
          // reassuring line, in the engine's own words. Deliberately the
          // item's *own* sentence rather than the generic setup one: H-22's
          // minimum-age wording says something a diver can act on, and
          // collapsing to "still finalizing" would throw it away.
          <p className="mt-8 text-base text-muted">{checklistDetailText(t, spine.setupItem)}</p>
        ) : (
          <>
            {stageLine ? <BoatStageLine {...stageLine} /> : null}
            <ThreadStatus
              lead={
                spine.done === spine.countable
                  ? t("ready.allSetHeading")
                  : currentStep
                    ? t(threadNextKey(currentStep))
                    : t("thread.withShopHead")
              }
              progress={t("thread.stepsDone", { done: spine.done, total: spine.countable })}
              settled={spine.done === spine.countable}
            />
            <ThreadSpine steps={spineSteps} heading={t("ready.checklistHeading")} />
            {atShopLine ? <p className="mt-4 text-base text-muted">{atShopLine}</p> : null}
          </>
        )}
        <CourseNextStepNote db={db} shopId={shop.id} bookingId={bookingId} t={t} />
        <ThreadSections
          context={{
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
          }}
        />
        {yourDays}
      </>
    );
  })();

  /**
   * What sits under the opening: the one-shot flash cleanup, the notice, the
   * device memory of who just booked, and the thread. Under the booked card
   * (`underBookedHeader`) this is the whole of what this function renders: the
   * card, the shell and the provider already painted from the booking's own row.
   */
  const below = (
    <>
      {/* `booked` among them: the celebration is the moment a seat was taken,
          not a property of the link. Leaving it in the URL would replay
          "You've got a seat" every time a diver reopened this page from
          their history three days later. */}
      <FlashParams params={["saved", "error", "pay", "booked"]} />
      {notice ? (
        <div className="mt-6">
          <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
            {t(notice.key)}
          </ShopNotice>
        </div>
      ) : null}
      {/* Client-only, per-device convenience (task 27): remember who just
          booked, never on a held seat (#2125), to prefill their next visit. */}
      {justBooked && person.email && !data.identityHeld ? (
        <RememberBooker fullName={detail.person.fullName} email={person.email} />
      ) : null}
      {/* Keep this page on the phone for the marina with no signal, on both
          openings (the booked card and the ordinary masthead), and date the
          copy by the live page itself (security review of layer 8, D2). */}
      <ReadyOfflineCopy copy={readyOfflineWords(t)} keepUntil={readyCopyKeepUntil(detail.trip)} />
      {/* The spine, the arrival card, the packing list and the cancel door
          read seven more things between them, and arrive behind a body-shaped
          fallback rather than holding the opening above them (UX audit #5). */}
      <Suspense fallback={<ReadyThreadBodySkeleton />}>{threadBody}</Suspense>
    </>
  );

  return underBookedHeader ? (
    below
  ) : (
    // The whole page under the provider, not just the one Client Component
    // that needs it today: a `useTranslations` call in a client child without
    // it throws during the server render and takes the entire page down to a
    // blank 200 (which is exactly how RentalFitForm broke this surface once).
    // Its namespaces are "rental" (RentalFitForm), "common" (shared field
    // hints) and "trip" (TripActions), the same list the booked path mounts.
    <DiverIntlProvider
      locale={locale}
      timeZone={detail.shop.timezone}
      namespaces={["rental", "common", "trip"]}
    >
      <ThreadShell
        shopName={detail.shop.name}
        title={detail.trip.title}
        meta={
          <ReadyMastheadMeta
            facts={{
              shop: {
                name: detail.shop.name,
                slug: shop.slug,
                timezone: detail.shop.timezone,
                dockCallMinutes: shop.dockCallMinutes,
              },
              trip: detail.trip,
              pickup: { time: data.pickupTime, location: data.hotelPickupLocation },
            }}
            locale={locale}
            now={nowDate()}
            t={t}
          />
        }
      >
        {below}
      </ThreadShell>
    </DiverIntlProvider>
  );
}
