import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import { ActivityLog } from "@/components/ActivityLog";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { FlashParams } from "@/components/FlashParams";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { canPersonManagePaymentSettings, canPersonRefund } from "@/db/authz";
import { getTripGuests } from "@/db/trips-guests";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { cancellationDeadline } from "@/lib/deposits";
import { formatShortDate } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeForForm, shopPath } from "@/lib/staff-notices";
import { isFull, spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { AddDiverSection } from "../_components/AddDiverSection";
import { LastMinuteDealSection } from "../_components/LastMinuteDealSection";
import { RosterSection } from "../_components/RosterSection";
import { TripInvitationGroup } from "../_components/TripInvitationSection";
import { resolveTripNotice, TripNoticeBanner } from "../_components/TripNoticeBanner";
import { TripCapacityBadge, TripPageHeader } from "../_components/TripPageHeader";
import { WaitlistGroup } from "../_components/WaitlistSection";
import {
  addInternalNoteAction,
  addToWaitlistAction,
  certifyDiverFromRosterAction,
  confirmDiverIdentityAction,
  createDirectTripInvitationAction,
  deleteInternalNoteAction,
  inviteWaitlistAction,
  markPaymentAction,
  markWaiverInPersonAction,
  recordTripInvitationAction,
  removeBookingAction,
  restoreInternalNoteAction,
  saveRosterEmergencyContactAction,
  sendLastMinuteDealAction,
  undoRemoveBookingAction,
  updateBookingPickupAction,
} from "../actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. Not a claim of a static shell: the staff shell layout declares
// `instant = false` (read its comment for why), so a cold direct visit still
// blocks on the session and shop row. What this validates is the navigation
// staff make all day — arriving from another `/shop` page, where the shell
// is already mounted. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Trip guests — DiveDay",
};

type TripGuestsSearchParams = Promise<{
  notice?: string;
  bid?: string;
  diverq?: string;
  inviteq?: string;
  count?: string;
  /** Which form on this page the notice answers — see `resolveTripNotice`. */
  form?: string;
  /**
   * The signed trip-admission refusal behind a `diver-trip-prerequisite`
   * notice, verified against this route's own `id`
   * (src/lib/trip-admission-gate.ts). `string[]` because a repeated `?gate=`
   * really delivers one.
   */
  gate?: string | string[];
  rf?: string;
  /** The deleted note's booking + text, carried by the land-then-undo redirect (§7). */
  noteBookingId?: string;
  noteBody?: string;
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
}>;

/**
 * Who is attending — the one place the roster, wait list, and every per-diver
 * action (waiver, payment, rental fit, remove) live. What the dive *is* stays on
 * Overview; the day-of boarding and roll call live on the Manifest. Splitting
 * "who" from "what" is why every roster action has exactly one home.
 *
 * Not `instant = false`, which (per
 * node_modules/next/dist/docs/.../instant.md) is a dev-time validation
 * opt-out only and has no effect on production rendering. Without a real
 * Suspense boundary, this route still gets a Partial-Prerendered static
 * shell with an implicit dynamic hole around the unwrapped
 * `searchParams`/session reads — and `addBookingAction`'s
 * `revalidateAndRedirect(...?notice=diver-added...)` (the shared
 * src/app/actions/seat-diver.ts) raced
 * that hole's own pending fetch, matching the class of bug fixed on
 * /sign-in and dive-sites/new. This action lives in a sibling
 * `actions.ts` rather than this file, which is also why the earlier grep for
 * this bug class (co-located `redirect(` in the same `page.tsx`) missed it.
 * (`addBookingAction` is now the shared `seatNewDiverAction`; the hazard and
 * the reason for the Suspense boundary are unchanged.)
 */
export default function TripGuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: TripGuestsSearchParams;
}) {
  return (
    <Suspense fallback={null}>
      <TripGuestsBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function TripGuestsBody({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: TripGuestsSearchParams;
}) {
  const { shopSlug, id: tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  // `rf` (the retired roster filter) is deliberately not read: old deep links
  // still carry it, and the groups now do what the chips did.
  const {
    notice,
    bid,
    diverq,
    count,
    form,
    gate,
    noteBookingId,
    noteBody,
    confirmName,
    confirmEmail,
    confirmPhone,
  } = await searchParams;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const guests = await getTripGuests(db, shop, tripId, { diverQuery: diverq, confirmName });
  if (!guests) notFound();
  const {
    trip,
    cancelled,
    roster,
    requirement,
    waitlist,
    invitations,
    activity,
    confirmMatches,
    diverCandidates,
    notesByBooking,
    paymentsConnected,
    demand,
    lastMinute,
    certificationSummaries,
    byBooking,
    diverQuery,
    tripDateIso,
    dealRequirement,
    courseTarget,
  } = guests;
  const {
    showPromote: dealHasRecipients,
    promos: lastMinutePromos,
    promoRecipients: lastMinutePromoRecipients,
    recipients: lastMinuteRecipients,
  } = lastMinute;
  // Hidden, not explained, for a staffer who cannot use it (ADR
  // 20260724-role-gated-surfaces-hide-not-explain). Discounting is money work —
  // the same gate the shop-wide promo page carries on both its page and its
  // actions — and `sendLastMinuteDealAction` refuses independently, because a
  // hidden control is not a gate (issue #714).
  const mayDiscount = await canPersonManagePaymentSettings(db, shop.id, session.user.personId);
  // `waived` and `refunded` are decisions about money, gated by `canRefund`
  // everywhere else; recording counter cash stays open to the crew (issue #714).
  const mayWriteOffPayment = await canPersonRefund(db, shop.id, session.user.personId);
  const showPromote = dealHasRecipients && mayDiscount;
  const {
    rentalFit: rentalFitByBooking,
    nitrox: nitroxByBooking,
    readiness: readinessByBooking,
    waiver: waiverByBooking,
  } = byBooking;

  // Undo is safe for every money-neutral removal but must never appear after a
  // real refund: restoreBooking can't un-refund, so it would re-seat a diver
  // whose money is already gone (dive-domain review).
  const undoBookingId =
    notice?.startsWith("booking-removed") && notice !== "booking-removed-refunded"
      ? bid
      : undefined;
  // The row a staffer just acted on renders expanded with its panel open on
  // arrival — a saved contact moves from the card's open half into its
  // reference panel, and a payment marked settled can collapse the whole
  // card, so without this the thing they just touched appears to have
  // vanished. Both contact outcomes count: an incomplete pair (a name with
  // no phone) still saved something and still needs its field back.
  const keepOpenBookingId =
    notice === "contact-saved" || notice === "contact-incomplete" || notice === "payment"
      ? bid
      : undefined;
  // One resolution, routed to the form it answers. The roster's per-diver
  // outcomes stay on the page banner — they carry the undo control, and the
  // row they belong to is already named by `?bid=`.
  const tripNotice = resolveTripNotice({ notice, count, form, gate, tripId, locale });
  // "Promote this trip" appears only when there is somebody to promote it to.
  // The panel used to render for every departure and, on the great majority of
  // them, opened onto a single empty state — a marketing console offered to a
  // shop whose last-minute list is empty, or whose members all said they are
  // around some other week. An offer nobody can accept is not a control, it is
  // a row of chrome on the tab that answers "who is attending" (principle 10).
  // A blast that *has* gone out keeps its panel regardless: the record of what
  // was sent, to how many people, is trip history and outlives the list that
  // received it. Today's own "fill these seats" row is gated on the same reach
  // (src/db/today.ts), so its `#last-minute-deal` anchor cannot point at a
  // section this hides.
  // The panel is shown if there are people on the last-minute list whose date
  // range covers this trip (even if they don't meet current requirements) OR if
  // there are promos (history of blasts sent). This allows the empty state
  // "Nobody to send this to yet" to render when requirements are raised.
  // The deal panel, when shown, is inside a <details> whose `#last-minute-deal`
  // landing auto-opens; the add-diver section is not rendered on a cancelled
  // departure, so its notices fall back to the banner — as do the deal's own on
  // the (unreachable in practice) hidden case.
  const guestSections = new Set([
    ...(cancelled ? [] : ["add-diver"]),
    ...(showPromote ? ["last-minute-deal"] : []),
  ]);
  const pageNotice = tripNotice && guestSections.has(tripNotice.form) ? undefined : tripNotice;

  return (
    <div data-trip-guests-ready className="contents">
      <FlashParams params={["notice", "bid", "form", "noteBookingId", "noteBody"]} />
      <TripPageHeader
        boardHref={shopPath(shopSlug, "schedule", "board")}
        backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
        trip={trip}
        locale={locale}
        timeZone={shop.timezone}
        badge={
          // The roster heading below owns the seat numbers on this tab —
          // "8 of 10 divers booked" — so a "2 spots left" pill above it would
          // state the same fact twice (principle 9), the same reasoning that
          // stands the badge down on Overview while the pulse beats. Two
          // states still earn the pill: Cancelled, and the success-toned
          // "Full" — a sold-out boat is a win worth noticing (principle 3),
          // and "10 of 10 divers booked" in muted ink is not the noticing.
          cancelled || isFull(trip) ? (
            <TripCapacityBadge
              trip={trip}
              cancelledLabel={t("trips.guests.cancelledBadge")}
              t={t}
            />
          ) : undefined
        }
        extraMeta={
          trip.course ? (
            <p className="text-sm font-medium text-primary">
              {t("trips.guests.courseSession", { title: trip.course.title })}
            </p>
          ) : null
        }
      />

      {/* A deleted private note is a purely reversible edit, so it gets a
          land-then-undo toast instead of the plain success banner
          (docs/design/principles.md §7) — same either/or as
          divers/[personId]/page.tsx's card-delete undo. */}
      {notice === "note-deleted" && noteBookingId && noteBody ? (
        <UndoToast
          message={t("trips.roster.noteDeletedToast")}
          action={restoreInternalNoteAction.bind(null, shopSlug, tripId)}
          fields={{ bookingId: noteBookingId, body: noteBody }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : (
        <TripNoticeBanner
          notice={pageNotice}
          locale={locale}
          undoBookingId={undoBookingId}
          undoAction={undoRemoveBookingAction.bind(null, shopSlug, tripId)}
        />
      )}

      {demand ? (
        <section className="mt-6 rounded-xl border border-warning/40 bg-warning-tint p-5">
          <p className="text-xs font-semibold tracking-widest text-warning uppercase">
            {t("trips.guests.demandSignal")}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{t("trips.guests.demandHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{demand.message}</p>
          {/* Opens the board's add panel already dated to *this* departure's
              day: the demand signal is "this boat is turning divers away", and
              the answer a shop reaches for is a second boat on the same day,
              not a blank date box. */}
          <Link
            href={`${shopPath(shopSlug, "schedule", "board")}?add=1&date=${toDateInputValue(
              utcToWallTime(trip.startsAt, shop.timezone),
            )}`}
            className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
          >
            {t("trips.guests.scheduleAnotherDeparture")}
          </Link>
        </section>
      ) : null}

      {/* The birthday panel that used to sit here is gone: it restated, above
          the roster, the same callout each celebrating diver's own row wears
          as its warm capsule (principle 9 — say it once, on the person). H-21's
          good news still reads before that person's blockers, on the line that
          carries their name. */}
      <RosterSection
        locale={locale}
        shopSlug={shopSlug}
        shopTimezone={shop.timezone}
        tripId={tripId}
        booked={trip.booked}
        capacity={trip.capacity}
        roster={roster}
        canAddDivers={!cancelled}
        readinessByBooking={readinessByBooking}
        waiverByBooking={waiverByBooking}
        rentalFitByBooking={rentalFitByBooking}
        nitroxByBooking={nitroxByBooking}
        requiresPayment={Boolean(requirement?.requiresPayment)}
        paymentsConnected={paymentsConnected}
        cancellationDeadline={cancellationDeadline(trip)}
        markWaiverInPersonAction={markWaiverInPersonAction.bind(null, shopSlug, tripId)}
        markPaymentAction={markPaymentAction.bind(null, shopSlug, tripId)}
        mayWriteOffPayment={mayWriteOffPayment}
        removeBookingAction={removeBookingAction.bind(null, shopSlug, tripId)}
        confirmIdentityAction={confirmDiverIdentityAction.bind(null, shopSlug, tripId)}
        // Only a course session's own roster gets the tap (issue #717) — a
        // fun dive has no completion to certify.
        certifyDiverAction={
          trip.course ? certifyDiverFromRosterAction.bind(null, shopSlug, tripId) : undefined
        }
        notesByBooking={notesByBooking}
        addNoteAction={addInternalNoteAction.bind(null, shopSlug, tripId)}
        deleteNoteAction={deleteInternalNoteAction.bind(null, shopSlug, tripId)}
        saveEmergencyContactAction={saveRosterEmergencyContactAction.bind(null, shopSlug, tripId)}
        updatePickupAction={updateBookingPickupAction.bind(null, shopSlug, tripId)}
        keepOpenBookingId={keepOpenBookingId}
        depthUnit={shop.depthUnit}
        tripDate={tripDateIso}
        // The wait list and recorded invitations are groups of the same
        // ledger, not sibling cards — everyone this departure is about, in
        // one object (slice 5d). Each renders only when someone is actually
        // in it: an empty group is "None" formatted as a section
        // (design/principles.md #9). Today's invite-from-the-wait-list row
        // only exists when waiting > 0, so its `#waitlist` landing always
        // finds the group's band.
        waitingGroup={
          waitlist.length > 0 ? (
            <WaitlistGroup
              waitlist={waitlist}
              shopSlug={shopSlug}
              tripId={tripId}
              shopName={shop.name}
              tripTitle={trip.title}
              tripWhen={formatShortDate(trip.startsAt, locale, shop.timezone)}
              inviteAction={inviteWaitlistAction.bind(null, shopSlug, tripId)}
              certificationSummaries={certificationSummaries}
              /* The same folded gate the deal panel below states. The shared
                 predicate marks the row without reordering, filtering, or
                 gating this lead list. */
              departureRequirement={dealRequirement}
              locale={locale}
              timezone={shop.timezone}
            />
          ) : null
        }
        invitedGroup={
          invitations.length > 0 ? (
            <TripInvitationGroup
              invitations={invitations}
              shopSlug={shopSlug}
              tripId={tripId}
              shopName={shop.name}
              tripTitle={trip.title}
              tripStartsAt={trip.startsAt}
              timezone={shop.timezone}
              inviteAction={recordTripInvitationAction.bind(null, shopSlug, tripId)}
              locale={locale}
            />
          ) : null
        }
      />

      {cancelled ? null : (
        <AddDiverSection
          shopSlug={shopSlug}
          full={isFull(trip)}
          query={diverQuery}
          candidates={diverCandidates}
          tripId={tripId}
          addBookingAction={seatNewDiverAction.bind(null, "trip-guests", shopSlug)}
          addToWaitlistAction={addToWaitlistAction.bind(null, shopSlug, tripId)}
          addExistingDiverAction={seatExistingDiverAction.bind(null, "trip-guests", shopSlug)}
          inviteAction={createDirectTripInvitationAction.bind(null, shopSlug, tripId)}
          status={noticeForForm(tripNotice, "add-diver")}
          locale={locale}
          confirmName={confirmName}
          confirmEmail={confirmEmail}
          confirmPhone={confirmPhone}
          confirmMatches={confirmMatches}
        />
      )}

      {/* **The quiet tail** (slice 5d, after the canvas's "quiet
          housekeeping, no chrome"): the marketing blast and the audit trail
          are the two things on this page that are not people, so they stop
          wearing the same card the ledger wears and settle into two hairline
          rows — kept at all only because a trip's history and its promotion
          record have no other home yet (docs/design/surfaces.md, "remove
          first"). The blast stays collapsed by default (Guests is "who is
          attending," not a promo console — task 156); Today's "fill seats"
          row still lands on #last-minute-deal and auto-opens it. A hard
          navigation opens a closed ancestor <details> for a same-page anchor
          on its own, but a Next.js <Link> transition doesn't run that native
          "reveal" algorithm — AutoOpenDetails covers both. */}
      <div className="mt-12">
        {showPromote ? (
          <AutoOpenDetails
            openOnHash="last-minute-deal"
            className="group/promote border-t border-border scroll-mt-6"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-muted transition-colors [&::-webkit-details-marker]:hidden hover:text-foreground">
              <span>{t("trips.guests.promoteHeading")}</span>
              <span className="flex items-center gap-2">
                {lastMinutePromos.length > 0
                  ? t("trips.guests.promoteSentCount", { count: lastMinutePromos.length })
                  : null}
                <DisclosureCaret
                  direction="down"
                  className="size-4 group-open/promote:rotate-180"
                />
              </span>
            </summary>
            <div className="pb-5">
              <LastMinuteDealSection
                shopSlug={shopSlug}
                locale={locale}
                recipients={lastMinuteRecipients.map(({ person }) => ({
                  personId: person.id,
                  fullName: person.fullName,
                  certification: certificationSummaries.get(person.id) ?? null,
                }))}
                requirement={dealRequirement}
                course={courseTarget}
                openSeats={spotsRemaining({ capacity: trip.capacity, booked: trip.booked })}
                cancelled={cancelled}
                promos={lastMinutePromos}
                promoRecipients={lastMinutePromoRecipients}
                timezone={shop.timezone}
                status={noticeForForm(tripNotice, "last-minute-deal")}
                sendAction={sendLastMinuteDealAction.bind(null, shopSlug, tripId)}
              />
            </div>
          </AutoOpenDetails>
        ) : null}

        <details className="group/activity border-y border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-muted transition-colors [&::-webkit-details-marker]:hidden hover:text-foreground">
            <span>{t("trips.guests.activityHeading")}</span>
            <DisclosureCaret direction="down" className="size-4 group-open/activity:rotate-180" />
          </summary>
          <div className="pb-5">
            <ActivityLog
              events={activity}
              locale={locale}
              timeZone={shop.timezone}
              emptyText={t("trips.guests.noActivity")}
            />
          </div>
        </details>
      </div>
    </div>
  );
}
