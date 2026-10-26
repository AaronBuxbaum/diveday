import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { type GearItemDetail, getGearItemDetail } from "@/db/gear";
import {
  gearItemKindLabel,
  gearPhaseLabel,
  gearReturnOutcomeLabel,
  gearServiceKindLabel,
  gearServiceStateText,
} from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { gearServiceState, reservationPhase } from "@/lib/gear";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { GearItemNotes, NoteDoor } from "./_components/GearItemNotes";
import { aboardText, gearUnitHull } from "./_components/KindFacts";
import { ServiceLogDoor } from "./_components/ServiceLogDoor";
import { DeleteUnitFoot } from "./_components/UnitStatus";
import { UnitSummary } from "./_components/UnitSummary";
import {
  checkOutGearReservationFromUnitAction,
  releaseGearReservationAction,
  returnGearReservationFromUnitAction,
} from "./actions";

const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  updated: { tone: "success", key: "gear.notice.updated" },
  "service-logged": { tone: "success", key: "gear.notice.serviceLogged" },
  released: { tone: "success", key: "gear.notice.released" },
  returned: { tone: "success", key: "gear.notice.returned" },
  "checked-out": { tone: "success", key: "gear.notice.checkedOut" },
  "already-returned": { tone: "warning", key: "gear.notice.alreadyReturned" },
  "already-checked-out": { tone: "warning", key: "gear.notice.alreadyCheckedOut" },
  "not-found": { tone: "danger", key: "gear.notice.notFound" },
  // The refused delete. It renders beside the Delete control naming the
  // reservation that holds the unit; this banner is the fallback for the race
  // where that reservation was closed between the refusal and this render.
  "unit-held": { tone: "danger", key: "gear.notice.unitHeld" },
  invalid: { tone: "danger", key: "gear.notice.invalid" },
  "empty-label": { tone: "danger", key: "gear.notice.emptyLabel" },
  "duplicate-label": { tone: "danger", key: "gear.notice.duplicateLabel" },
  "invalid-date": { tone: "danger", key: "gear.notice.invalidDate" },
  "due-not-after-service": { tone: "danger", key: "gear.notice.dueNotAfterService" },
  "invalid-dives": { tone: "danger", key: "gear.notice.invalidDives" },
  "dives-need-a-date": { tone: "danger", key: "gear.notice.divesNeedADate" },
};

/**
 * **Which door a `?notice=` re-opens.**
 *
 * The three forms on this page open on request now, and a save redirects, so the form that earned
 * an outcome has to come back standing — otherwise a refused date is a banner at the top of the
 * page over a shut box the staffer has to find again. The banner still carries the words in every
 * case; this only decides which form is on screen beneath it.
 *
 * `service-logged` opens both the service door and the notes door because one
 * action (`recordGearServiceAction`) writes both, and the notice cannot say
 * which — the alternative is a second success code that means the same thing.
 */
const SERVICE_NOTICES = new Set([
  "service-logged",
  "invalid-date",
  "due-not-after-service",
  "invalid-dives",
  "dives-need-a-date",
]);
/** A refused details save brings the form back standing, with the words. */
const DETAILS_REFUSALS = new Set(["empty-label", "duplicate-label"]);

// See the register page's copy of this comment (ADR 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = { title: "Gear unit — DiveDay" };

export default async function GearUnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; edit?: string }>;
}) {
  const { shopSlug, id } = await params;
  const { notice, edit } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(id)) notFound();
  const detail = await getGearItemDetail(db, shop.id, id);
  if (!detail) notFound();
  const hull = await gearUnitHull(db, shop, detail.item);

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  const { item, clocks, history, reservations, priorAssignments } = detail;
  // A dated condition note carries no clock and isn't service work — it reads
  // in its own Notes section below, never twice.
  const serviceHistory = history.filter((event) => event.kind !== "note");
  const notes = history.filter((event) => event.kind === "note");
  const state = gearServiceState(clocks, todayLocal);
  const banner = noticeFromParam(notice, NOTICES);
  /**
   * A deleted unit keeps this record — the service history is the reason the
   * row survives the delete, and reaching it used to mean restoring the unit
   * onto the live register to read it (issue #614). Read-only, without
   * exception: every writer in `src/db/gear.ts` refuses a deleted row, so a
   * rendered form would be a control that cannot work.
   */
  const deletedAt = item.deletedAt;
  const openReservations = deletedAt
    ? []
    : reservations.filter((reservation) => !reservation.returnedAt);
  // On a deleted unit the rental record is the whole list: nothing here is
  // actionable, and a "where is it" panel would be answering about a unit the
  // shop has taken off the wall.
  const settled = deletedAt ? reservations : reservations.filter((r) => r.returnedAt);

  /**
   * A refused delete is about the unit's reservations, so it is worded from
   * them rather than from the redirect: the same rule that keeps the holder's
   * name out of the query string keeps the sentence true to what the page is
   * showing. `deleteGearItem` refuses on exactly this shape — still out, or
   * spoken for today or later.
   */
  const holding =
    notice === "unit-held"
      ? (openReservations.find(
          (reservation) =>
            reservation.checkedOutAt !== null || reservation.reservedUntil >= todayLocal,
        ) ?? null)
      : null;
  const held = holding
    ? {
        name: holding.personName,
        until: formatCalendarDate(holding.reservedUntil, locale),
      }
    : null;

  // Safety kit names its hull ("the AED on Mantis I"): part of what it *is*.
  // The rest of the record is the summary panel's list, so the masthead does
  // not say it twice (visual review 2026-10-24, A19).
  const identity = [gearItemKindLabel(t, item.kind), aboardText(hull, t)]
    .filter(Boolean)
    .join(" · ");
  const unitPath = `/shop/${shopSlug}/gear/${item.id}`;
  // "Edit details" is the header's door; the form opens in the summary panel,
  // server-rendered, and a refused save comes back to it standing.
  const editing = !deletedAt && (edit === "details" || DETAILS_REFUSALS.has(notice ?? ""));
  const hasService = clocks.length > 0 || serviceHistory.length > 0;
  const hasRentals = settled.length > 0 || priorAssignments.length > 0;
  /** No service, no notes, not deleted: the note door rides the empty line. */
  const notesOnLine = !hasService && !deletedAt && notes.length === 0;

  return (
    <StaffPage width="reading">
      <FlashParams params={["notice"]} />
      <div>
        <ShopPageHeader
          eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.gear)}
          eyebrowHref={`/shop/${shopSlug}/gear`}
          title={item.label}
          description={identity}
          meta={
            deletedAt ? (
              // The one fact that explains the whole page: no forms, and a
              // Restore where the Delete was. A live unit's status is the
              // summary panel's first line, so it does not also render here.
              <Badge tone="warning">{t("gear.unit.deleted.badge")}</Badge>
            ) : state.state === "due_soon" || state.state === "overdue" ? (
              <span
                className={`text-sm font-medium ${state.state === "overdue" ? "text-warning-strong" : "text-muted"}`}
              >
                {gearServiceStateText(t, state, formatCalendarDate(state.nextDueOn, locale))}
              </span>
            ) : undefined
          }
          actions={
            deletedAt || editing ? undefined : (
              <Link
                href={`${unitPath}?edit=details#unit-details`}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("gear.unit.details.edit")}
              </Link>
            )
          }
        />
      </div>

      {banner && !held ? (
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      <div className="mt-8 space-y-10">
        {/* Eight words don't need a card of their own: the panel exists only
            when there are reservations carrying actions. */}
        {deletedAt ? null : openReservations.length === 0 ? (
          <p className="text-sm text-muted">{t("gear.unit.where.inShop")}</p>
        ) : (
          <SectionCard title={t("gear.unit.where.title")}>
            <ul className="flex flex-col gap-3">
              {openReservations.map((reservation) => {
                const phase = reservationPhase(reservation, todayLocal);
                return (
                  <li
                    key={reservation.reservationId}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2"
                  >
                    {/* Full first line on phone, one row from `sm` up — the
                        same wrap rule as the register's returns panel. */}
                    <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                      <p className="font-medium">
                        {reservation.tripTitle
                          ? t("gear.returns.holderWithTrip", {
                              name: reservation.personName,
                              tripTitle: reservation.tripTitle,
                            })
                          : t("gear.returns.holder", { name: reservation.personName })}
                      </p>
                      <p className="mt-0.5 text-sm text-muted">
                        {t("gear.unit.where.window", {
                          from: formatCalendarDate(reservation.reservedFrom, locale),
                          until: formatCalendarDate(reservation.reservedUntil, locale),
                        })}
                      </p>
                    </div>
                    <Badge tone={phase === "overdue" ? "warning" : "neutral"} size="sm">
                      {gearPhaseLabel(t, phase)}
                    </Badge>
                    <div className="flex gap-2">
                      {reservation.checkedOutAt === null ? (
                        <>
                          <form action={checkOutGearReservationFromUnitAction}>
                            <input type="hidden" name="gearItemId" value={item.id} />
                            <input
                              type="hidden"
                              name="reservationId"
                              value={reservation.reservationId}
                            />
                            <SubmitButton
                              pendingLabel={t("gear.returns.checkingOut")}
                              className={buttonClass({ variant: "secondary", size: "sm" })}
                            >
                              {t("gear.returns.checkOut")}
                            </SubmitButton>
                          </form>
                          <form action={releaseGearReservationAction}>
                            <input type="hidden" name="gearItemId" value={item.id} />
                            <input
                              type="hidden"
                              name="reservationId"
                              value={reservation.reservationId}
                            />
                            <SubmitButton
                              pendingLabel={t("gear.unit.where.releasing")}
                              className={buttonClass({ variant: "ghost", size: "sm" })}
                            >
                              {t("gear.unit.where.release")}
                            </SubmitButton>
                          </form>
                        </>
                      ) : (
                        <form action={returnGearReservationFromUnitAction}>
                          <input type="hidden" name="gearItemId" value={item.id} />
                          <input
                            type="hidden"
                            name="reservationId"
                            value={reservation.reservationId}
                          />
                          <SubmitButton
                            pendingLabel={t("gear.returns.returning")}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            {t("gear.returns.markReturned")}
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}

        <UnitSummary
          detail={detail}
          hull={hull}
          editing={editing}
          unitPath={unitPath}
          t={t}
          locale={locale}
          zone={shop.timezone}
        />

        {/* Service and history render only when they hold rows. A unit with
            neither says so in one line, and the log door stands on it, since
            logging the first service is how the card comes to exist. With no
            notes either, "Add a note" joins that line instead of an empty
            Notes card (visual review A19); an opened door takes the full row. */}
        {hasService ? (
          <ServiceCard
            item={item}
            clocks={clocks}
            history={serviceHistory}
            t={t}
            locale={locale}
            todayLocal={todayLocal}
            readOnly={deletedAt !== null}
            formOpen={SERVICE_NOTICES.has(notice ?? "")}
          />
        ) : deletedAt ? null : (
          <section
            aria-label={t("gear.unit.service.title")}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-2 sm:gap-x-4"
          >
            {hasRentals ? null : (
              <p className="text-sm text-muted">{t("gear.unit.noServiceOrHistory")}</p>
            )}
            <ServiceLogDoor
              item={item}
              t={t}
              todayLocal={todayLocal}
              formOpen={SERVICE_NOTICES.has(notice ?? "")}
            />
            {notesOnLine ? (
              <NoteDoor
                gearItemId={item.id}
                todayLocal={todayLocal}
                t={t}
                formOpen={notice === "service-logged"}
                className="open:basis-full"
              />
            ) : null}
          </section>
        )}

        {hasRentals ? (
          <SectionCard padding="none" title={t("gear.unit.rentals.title")}>
            <ul className="divide-y divide-border">
              {settled.map((reservation) => (
                <li key={reservation.reservationId} className="px-4 py-3 sm:px-5">
                  <p className="text-sm font-medium">
                    {reservation.tripTitle
                      ? t("gear.returns.holderWithTrip", {
                          name: reservation.personName,
                          tripTitle: reservation.tripTitle,
                        })
                      : t("gear.returns.holder", { name: reservation.personName })}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {t("gear.unit.where.window", {
                      from: formatCalendarDate(reservation.reservedFrom, locale),
                      until: formatCalendarDate(reservation.reservedUntil, locale),
                    })}
                  </p>
                  {/* **How it came home** (issue #1186, D26), which is the whole
                      reason the counter is asked. `return_note` has been
                      written since the register shipped and read by nothing at
                      all — the detail was there and invisible.

                      A concern is warning-toned and carries its words, because
                      this is the page a technician is standing on when they
                      decide whether to log bench time. It is a flag they
                      promote, never a `gear_service_events` row written behind
                      them: the clocks only mean "this needs a technician" for
                      as long as somebody chose to say so.

                      Nothing at all when nobody answered — silence is not
                      "all good", and inventing the reassuring word for a set
                      closed by a cancellation is what would make the other two
                      not worth reading. */}
                  {reservation.returnOutcome ? (
                    <p
                      className={`mt-1 text-sm ${
                        reservation.returnOutcome === "service_concern"
                          ? "text-warning-strong"
                          : "text-muted"
                      }`}
                    >
                      {gearReturnOutcomeLabel(t, reservation.returnOutcome)}
                      {reservation.returnNote ? ` · ${reservation.returnNote}` : ""}
                    </p>
                  ) : null}
                </li>
              ))}
              {priorAssignments.map((assignment) => (
                <li key={assignment.id} className="px-4 py-3 sm:px-5">
                  <p className="text-sm font-medium">
                    {t("gear.unit.rentals.importedAssignment", { name: assignment.personName })}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {t("gear.unit.where.window", {
                      from: formatCalendarDate(assignment.assignedFrom, locale),
                      until: formatCalendarDate(assignment.assignedUntil, locale),
                    })}
                    {assignment.statusLabel ? ` · ${assignment.statusLabel}` : ""}
                  </p>
                  {assignment.note ? (
                    <p className="mt-0.5 text-xs text-muted">{assignment.note}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}

        {/* A deleted unit with no notes ever written has an empty card and no
            form to fill it, so it gets no card at all; a live one with none
            carries its door on the empty line above. */}
        {(deletedAt && notes.length === 0) || notesOnLine ? null : (
          <GearItemNotes
            gearItemId={item.id}
            notes={notes}
            todayLocal={todayLocal}
            locale={locale}
            t={t}
            readOnly={deletedAt !== null}
            formOpen={notice === "service-logged"}
          />
        )}

        {deletedAt ? null : <DeleteUnitFoot item={item} held={held} t={t} />}
      </div>
    </StaffPage>
  );
}

/**
 * The unit's clocks and the form that winds them. Logging the work is this
 * page's most frequent act, so its submit is the page's one primary control.
 */
function ServiceCard({
  item,
  clocks,
  history,
  t,
  locale,
  todayLocal,
  readOnly,
  formOpen,
}: {
  item: GearItemDetail["item"];
  clocks: GearItemDetail["clocks"];
  history: GearItemDetail["history"];
  t: StaffTranslator;
  locale: string;
  todayLocal: string;
  /**
   * The unit is deleted: the clocks and the paper trail stay — they are what
   * the record is for — and the form that winds them goes. So does the urgency
   * line, which is an instruction to act on a unit that is off the wall.
   */
  readOnly: boolean;
  /** A save or a refusal from this form landed back here — bring it back standing. */
  formOpen: boolean;
}) {
  return (
    <SectionCard id="service" padding="lg" title={t("gear.unit.service.title")}>
      {clocks.length > 0 ? (
        <ul className="mb-6 flex flex-col gap-1.5">
          {clocks.map((clock) => (
            <li key={clock.kind} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">{gearServiceKindLabel(t, clock.kind)}</span>
              <span className="text-muted">
                {clock.nextDueOn
                  ? t("gear.unit.service.clock", {
                      servicedOn: formatCalendarDate(clock.servicedOn, locale),
                      dueOn: formatCalendarDate(clock.nextDueOn, locale),
                    })
                  : t("gear.unit.service.clockNoDue", {
                      servicedOn: formatCalendarDate(clock.servicedOn, locale),
                    })}
              </span>
              {/* The second interval, and the count it is being read against.
                  "At least" is the whole claim: the count rides the rentals the
                  shop wrote down, so a unit handed over on a handshake is not
                  in it. */}
              {clock.nextDueDives ? (
                <span className="text-muted">
                  {t("gear.unit.service.diveClock", {
                    since: clock.divesSince ?? 0,
                    due: clock.nextDueDives,
                  })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : readOnly ? null : (
        <p className="mb-6 text-sm text-muted">{t("gear.unit.service.noClocks")}</p>
      )}

      {/* **The clocks are the card; the log form opens on request.** Five
          fields standing open under the two facts a technician came to read
          made the section a form with a heading rather than a record — and
          logging bench work is a thing that happens the day the work is done,
          not every time somebody looks the unit up. The submit inside stays
          primary: it is still this page's most frequent act, and behind a door
          it shouts at nobody at rest. */}
      {readOnly ? null : (
        <ServiceLogDoor item={item} t={t} todayLocal={todayLocal} formOpen={formOpen} />
      )}

      {/* The paper trail rides the card whose clocks it explains, folded —
          the newest event of each kind is already the list above, so at rest
          the history would only repeat it (principle 9). */}
      {history.length > 0 ? (
        // Open on a deleted unit: the history is the whole reason that record
        // is reachable, so folding it would hide what the reader came for.
        //
        // Its door is drawn as the log door above it is, caret and all: a
        // flex summary drops the browser's marker, and a bare label was the
        // one disclosure on the card that did not say it opened (K-302).
        <details open={readOnly} className="group mt-6 border-t border-border pt-4">
          <summary
            className={buttonClass({
              variant: "link",
              size: "sm",
              flush: true,
              className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
            })}
          >
            {t("gear.unit.history.title", { count: history.length })}
            <DisclosureCaret direction="down" className="group-open:rotate-180" />
          </summary>
          {/* `first:pt-0 last:pb-0`: the rules go between entries, and the
              card's padding is the room at its foot, so a lone entry is not
              41px from the summary above and from the card's edge (K-432). */}
          <ul className="mt-2 divide-y divide-border">
            {history.map((event) => (
              <li key={event.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm">
                  <span className="font-medium">{gearServiceKindLabel(t, event.kind)}</span>
                  <span className="text-muted">
                    {" · "}
                    {formatCalendarDate(event.servicedOn, locale)}
                  </span>
                  {event.nextDueOn ? (
                    <span className="text-muted">
                      {" · "}
                      {t("gear.unit.history.nextDue", {
                        dueOn: formatCalendarDate(event.nextDueOn, locale),
                      })}
                    </span>
                  ) : null}
                </p>
                {event.note ? <p className="mt-0.5 text-sm text-muted">{event.note}</p> : null}
                {event.recordedByName ? (
                  <p className="mt-0.5 text-xs text-muted">
                    {t("gear.unit.history.recordedBy", { name: event.recordedByName })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </SectionCard>
  );
}
