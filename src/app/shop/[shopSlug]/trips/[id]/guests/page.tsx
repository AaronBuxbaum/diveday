import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { getDb } from "@/db/client";
import { listBookableDivers } from "@/db/divers";
import { listLastMinuteList } from "@/db/last-minute-list";
import { listBookingNotes, listTripActivity } from "@/db/operations";
import { getTripRequirements, getTripSiteRequirement, listTripReadiness } from "@/db/readiness";
import { listTripPrepDivers } from "@/db/rental-fit";
import { listCertificationSummaries } from "@/db/self-declared-cards";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { listTripLastMinutePromos } from "@/db/trip-promos";
import { getTripRoster, getTripWaitlist, getTripWithBooked } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { demandRecommendation } from "@/lib/demand";
import { cancellationDeadline } from "@/lib/deposits";
import { nitroxTanksApproved } from "@/lib/dive-prep";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import { lastMinuteEntryMatchesTripDate, orderLastMinuteRecipients } from "@/lib/last-minute-list";
import { combineCertRequirements } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { noticeForForm, shopPath } from "@/lib/staff-notices";
import { isFull, spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { AddDiverSection } from "../_components/AddDiverSection";
import { CelebrationsSection } from "../_components/CelebrationsSection";
import { LastMinuteDealSection } from "../_components/LastMinuteDealSection";
import { isRosterFilter, RosterSection } from "../_components/RosterSection";
import { resolveTripNotice, TripNoticeBanner } from "../_components/TripNoticeBanner";
import { TripCapacityBadge, TripPageHeader } from "../_components/TripPageHeader";
import { WaitlistSection } from "../_components/WaitlistSection";
import {
  addInternalNoteAction,
  addToWaitlistAction,
  confirmDiverIdentityAction,
  deleteInternalNoteAction,
  inviteWaitlistAction,
  markPaymentAction,
  markWaiverInPersonAction,
  removeBookingAction,
  restoreInternalNoteAction,
  saveRosterEmergencyContactAction,
  sendLastMinuteDealAction,
  undoRemoveBookingAction,
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

/**
 * How many activity entries show before the tail collapses behind "Show all":
 * enough to answer "what just happened on this trip" at a glance, few enough
 * that a season of history never buries the sections below.
 */
const RECENT_ACTIVITY_COUNT = 3;

type TripGuestsSearchParams = Promise<{
  notice?: string;
  bid?: string;
  diverq?: string;
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
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { notice, bid, diverq, count, form, gate, rf, noteBookingId, noteBody } =
    await searchParams;
  const rosterFilter = isRosterFilter(rf) ? rf : "all";
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  // The returning-diver picker only books, so it is skipped once the boat is
  // full — hand-entry then wait-lists instead.
  const diverQuery = diverq?.trim() ?? "";
  const diverCandidates =
    isFull(trip) || diverQuery === ""
      ? []
      : await listBookableDivers(db, shop.id, tripId, { query: diverQuery });
  const [
    roster,
    requirement,
    siteRequirement,
    readinessRows,
    prepDivers,
    waitlist,
    lastMinuteList,
    lastMinutePromos,
    bookingNotes,
    activity,
    stripeAccount,
  ] = await Promise.all([
    getTripRoster(db, shop.id, tripId),
    getTripRequirements(db, shop.id, tripId),
    getTripSiteRequirement(db, shop.id, tripId),
    listTripReadiness(db, shop.id, tripId),
    listTripPrepDivers(db, shop.id, tripId),
    getTripWaitlist(db, shop.id, tripId),
    listLastMinuteList(db, shop.id),
    listTripLastMinutePromos(db, shop.id, tripId),
    listBookingNotes(db, shop.id, tripId),
    listTripActivity(db, shop.id, tripId),
    getShopStripeAccount(db, shop.id),
  ]);
  // `orders/new` refuses without a payable account, so each seat's "Create
  // order" link points at connecting one instead of at a door that bounces.
  const paymentsConnected = canAcceptPayments(stripeAccount);
  const demand = demandRecommendation({
    capacity: trip.capacity,
    booked: trip.booked,
    waitlisted: waitlist.length,
  });
  const notesByBooking = new Map<string, typeof bookingNotes>();
  for (const row of bookingNotes) {
    if (!row.note.bookingId) continue;
    const rows = notesByBooking.get(row.note.bookingId) ?? [];
    rows.push(row);
    notesByBooking.set(row.note.bookingId, rows);
  }
  const tripDateIso = toDateInputValue(utcToWallTime(trip.startsAt, shop.timezone));
  // The same set, in the same order, that `sendLastMinuteDealBlast` would mail:
  // matched on the stated date window, then wait-listed divers first. A preview
  // that disagreed with the send would be worse than no preview — the staffer
  // would be vetting a list that isn't the one going out.
  const lastMinuteRecipients = orderLastMinuteRecipients(
    lastMinuteList.filter(({ entry }) => lastMinuteEntryMatchesTripDate(entry, tripDateIso)),
    waitlist.map(({ person }) => person.id),
  );
  /**
   * **The gate the deal panel states above its recipient list** — the trip's
   * own requirement folded with every dive site it visits, which is the same
   * effective requirement admission and readiness hold a diver to. The trip row
   * alone would go quiet on exactly the departure that hurts: a two-tank day
   * whose Advanced gate comes from the *second* site, where a shop would then
   * be told the trip asks for nothing and mail the discount to everybody.
   *
   * A missing requirements row folds to the identity rather than short-circuiting
   * to null, so a site-only gate still gets said out loud. That the row is
   * missing at all is the trip page's own warning to give (`RequirementsSection`
   * renders it in warning tone); this panel does not gate, so it does not
   * re-state it.
   */
  const dealRequirement = combineCertRequirements(
    requirement ?? {
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: false,
    },
    siteRequirement,
  );
  // One read for both panels: what each of these people can dive, as far as
  // anybody here knows. A joiner may have named their own level on the public
  // form, and it renders marked self-declared — the fact that stops a shop
  // mailing an Open Water diver a discount on a deep wreck (FU-20260813).
  const certificationSummaries = await listCertificationSummaries(db, shop.id, [
    ...new Set([
      ...lastMinuteRecipients.map(({ person }) => person.id),
      ...waitlist.map(({ person }) => person.id),
    ]),
  ]);
  // Undo is safe for every money-neutral removal but must never appear after a
  // real refund: restoreBooking can't un-refund, so it would re-seat a diver
  // whose money is already gone (dive-domain review).
  const undoBookingId =
    notice?.startsWith("booking-removed") && notice !== "booking-removed-refunded"
      ? bid
      : undefined;
  // A saved contact moves from the card's open half into its reference panel,
  // so the row that just saved opens on arrival — otherwise the form the
  // staffer was typing in appears to have vanished. Both outcomes count: an
  // incomplete pair (a name with no phone) still saved something and still
  // needs its field back.
  const savedContactBookingId =
    notice === "contact-saved" || notice === "contact-incomplete" ? bid : undefined;
  const cancelled = trip.status === "cancelled";
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
  const showPromote = lastMinuteRecipients.length > 0 || lastMinutePromos.length > 0;
  // The deal panel, when shown, is inside a <details> whose `#last-minute-deal`
  // landing auto-opens; the add-diver section is not rendered on a cancelled
  // departure, so its notices fall back to the banner — as do the deal's own on
  // the (unreachable in practice) hidden case.
  const guestSections = new Set([
    ...(cancelled ? [] : ["add-diver"]),
    ...(showPromote ? ["last-minute-deal"] : []),
  ]);
  const pageNotice = tripNotice && guestSections.has(tripNotice.form) ? undefined : tripNotice;
  const rentalFitByBooking = new Map(prepDivers.map((row) => [row.bookingId, row.fit] as const));
  const nitroxByBooking = new Map(
    prepDivers
      .filter((row) => row.wantsNitrox)
      .map(
        (row) => [row.bookingId, { requested: true, approved: nitroxTanksApproved(row) }] as const,
      ),
  );
  // The roster is the spine of the diver section; waiver and readiness detail
  // hang off it by booking id so each diver renders as one consolidated card.
  const readinessByBooking = new Map(readinessRows.map((row) => [row.booking.id, row] as const));
  // The freshest entries answer "what just happened here"; the tail waits
  // behind the disclosure below.
  const recentActivity = activity.slice(0, RECENT_ACTIVITY_COUNT);
  const olderActivity = activity.slice(RECENT_ACTIVITY_COUNT);
  const waiverByBooking = new Map(
    readinessRows.map(
      (row) =>
        [row.booking.id, { booking: row.booking, person: row.person, waiver: row.waiver }] as const,
    ),
  );

  return (
    <>
      <FlashParams params={["notice", "bid", "form", "noteBookingId", "noteBody"]} />
      <TripPageHeader
        trip={trip}
        locale={locale}
        timeZone={shop.timezone}
        badge={
          <TripCapacityBadge trip={trip} cancelledLabel={t("trips.guests.cancelledBadge")} t={t} />
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
        <section className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-5">
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

      {/* Sits above the roster so the good news is read before the blockers
          (H-21). Renders nothing when nobody on board is celebrating. */}
      <CelebrationsSection roster={roster} tripDate={tripDateIso} locale={locale} />

      <RosterSection
        locale={locale}
        shopSlug={shopSlug}
        shopTimezone={shop.timezone}
        tripId={tripId}
        booked={trip.booked}
        capacity={trip.capacity}
        roster={roster}
        rosterFilter={rosterFilter}
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
        removeBookingAction={removeBookingAction.bind(null, shopSlug, tripId)}
        confirmIdentityAction={confirmDiverIdentityAction.bind(null, shopSlug, tripId)}
        notesByBooking={notesByBooking}
        addNoteAction={addInternalNoteAction.bind(null, shopSlug, tripId)}
        deleteNoteAction={deleteInternalNoteAction.bind(null, shopSlug, tripId)}
        saveEmergencyContactAction={saveRosterEmergencyContactAction.bind(null, shopSlug, tripId)}
        savedContactBookingId={savedContactBookingId}
        depthUnit={shop.depthUnit}
        tripDate={tripDateIso}
      />

      {/* Below the roster and only when someone is actually waiting: an empty
          wait list used to lead this page as a full-width dashed card — "None"
          rendered as a status (design/principles.md #9). Today's own
          invite-from-the-wait-list row only exists when waiting > 0, so its
          `#waitlist` landing always finds this section. */}
      {waitlist.length > 0 ? (
        <WaitlistSection
          waitlist={waitlist}
          shopSlug={shopSlug}
          tripId={tripId}
          shopName={shop.name}
          tripTitle={trip.title}
          tripWhen={formatShortDate(trip.startsAt, locale, shop.timezone)}
          inviteAction={inviteWaitlistAction.bind(null, shopSlug, tripId)}
          certificationSummaries={certificationSummaries}
          /* The same folded gate the deal panel below states — a wait list is
             per-trip, so the departure the staffer is inviting onto is the one
             already resolved above. Passed as the rung alone: this list is not
             reordered, filtered, or gated by it, it is only said on the row. */
          minimumCertificationLevel={dealRequirement.minimumCertificationLevel}
          locale={locale}
          timezone={shop.timezone}
        />
      ) : null}

      {/* After the roster, not before it: this page's question is "who is
          attending", and the answer leads while the tools follow
          (design/principles.md #10). The empty roster's own action, seat-diver
          refusals, and the divers page's cross-link all land here by the
          `#add-diver` anchor, so the section keeps its place in the document
          without needing to sit above the fold. */}
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
          status={noticeForForm(tripNotice, "add-diver")}
          locale={locale}
        />
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t("trips.guests.activityHeading")}</h2>
        {activity.length === 0 ? (
          // The shared empty-section grammar, not a bare paragraph — the
          // roster above already wears the same dashed card for "nothing here"
          // (design/principles.md #4).
          <EmptyState className="mt-4">
            <p className="text-sm text-muted">{t("trips.guests.noActivity")}</p>
          </EmptyState>
        ) : (
          <>
            {/* When it happened is a column, not a trailing clause. Set inline
                after the sentence, the timestamps landed at a different x on
                every row — the eye reads them as part of the message and then
                has to re-find where the next one starts. Right-aligned they
                form the scannable edge a log wants, and `items-baseline` keeps
                the two texts on one line rather than one boxed above the other.
                Below `sm` the time drops under its own message instead of
                squeezing a name into two words. */}
            <ol className="mt-4 grid gap-2">
              {recentActivity.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-col gap-x-4 gap-y-0.5 rounded-lg bg-surface-sunken px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between"
                >
                  <span className="min-w-0">{event.message}</span>
                  <span className="shrink-0 text-muted tabular-nums">
                    {formatDateTimeTz(event.occurredAt, locale, shop.timezone)}
                  </span>
                </li>
              ))}
            </ol>
            {/* The tail waits behind a disclosure: the freshest entries answer
                "what just happened here", while a season's history at equal
                weight is noise (design/principles.md #9). */}
            {olderActivity.length > 0 ? (
              <details className="group mt-2">
                <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden hover:underline">
                  {t("trips.guests.activityShowAll", { count: activity.length })}
                  <DisclosureCaret direction="down" className="size-4 group-open:rotate-180" />
                </summary>
                <ol className="mt-2 grid gap-2">
                  {olderActivity.map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-col gap-x-4 gap-y-0.5 rounded-lg bg-surface-sunken px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between"
                    >
                      <span className="min-w-0">{event.message}</span>
                      <span className="shrink-0 text-muted tabular-nums">
                        {formatDateTimeTz(event.occurredAt, locale, shop.timezone)}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </>
        )}
      </section>

      {/* The marketing blast collapses behind its own disclosure (task 156,
          UX persona lens 17) — Guests is "who is attending," not a promo
          console. Collapsed by default; the trip's own recipient count still
          shows on the closed summary, and Today's "fill seats" row still
          lands here and auto-opens it (its href is this section's own
          #last-minute-deal anchor). A hard navigation opens a closed
          ancestor <details> for a same-page anchor on its own, but a
          Next.js <Link> transition doesn't run that native "reveal"
          algorithm — AutoOpenDetails covers both. */}
      {showPromote ? (
        <AutoOpenDetails
          openOnHash="last-minute-deal"
          // A `<details>` whose summary and panel pad themselves is a card
          // that is a *shell* — `padding="none"`.
          className={sectionCardClass({
            padding: "none",
            className: "group mt-10 scroll-mt-6",
          })}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span>{t("trips.guests.promoteHeading")}</span>
            <span className="flex items-center gap-2 text-muted">
              {lastMinutePromos.length > 0
                ? t("trips.guests.promoteSentCount", { count: lastMinutePromos.length })
                : null}
              <DisclosureCaret direction="down" className="size-4 group-open:rotate-180" />
            </span>
          </summary>
          {/* `p-4`, not `px-4`: with horizontal padding alone the panel's last
              row — the sent-deal list, or the empty state — ran flush into the
              card's bottom edge, while the section's own top margin left a wide
              gap above it. On a phone, where the rows wrap and fill the width,
              that read as a cut-off panel (2026-08-06 review). The section
              itself no longer carries a page-level top margin here; this
              container owns the inset, and it is the same `p-4` as the summary
              above it. */}
          <div className="border-t border-border p-4">
            <LastMinuteDealSection
              shopSlug={shopSlug}
              locale={locale}
              recipients={lastMinuteRecipients.map(({ person }) => ({
                personId: person.id,
                fullName: person.fullName,
                certification: certificationSummaries.get(person.id) ?? null,
              }))}
              requirement={dealRequirement}
              openSeats={spotsRemaining({ capacity: trip.capacity, booked: trip.booked })}
              cancelled={cancelled}
              promos={lastMinutePromos}
              timezone={shop.timezone}
              status={noticeForForm(tripNotice, "last-minute-deal")}
              sendAction={sendLastMinuteDealAction.bind(null, shopSlug, tripId)}
            />
          </div>
        </AutoOpenDetails>
      ) : null}
    </>
  );
}
