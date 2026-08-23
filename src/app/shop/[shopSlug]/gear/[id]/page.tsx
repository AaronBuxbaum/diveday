import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { type GearItemDetail, getGearItemDetail } from "@/db/gear";
import {
  gearItemKindLabel,
  gearPhaseLabel,
  gearServiceKindLabel,
  gearServiceStateText,
  gearStatusLabel,
} from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import {
  GEAR_KIND_ORDER,
  GEAR_SERVICE_KINDS_FOR,
  gearServiceState,
  reservationPhase,
} from "@/lib/gear";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
// The register's restore, not a second one: one act, one code path, and a tag
// collision on the way back answers on the page that holds the fleet it hit.
import { restoreGearItemAction } from "../actions";
import {
  checkOutGearReservationFromUnitAction,
  deleteGearItemAction,
  recordGearServiceAction,
  releaseGearReservationAction,
  returnGearReservationFromUnitAction,
  setGearItemStatusAction,
  updateGearItemAction,
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

// See the register page's copy of this comment (ADR 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = { title: "Gear unit — DiveDay" };

export default async function GearUnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug, id } = await params;
  const { notice } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(id)) notFound();
  const detail = await getGearItemDetail(db, shop.id, id);
  if (!detail) notFound();

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  const { item, clocks, history, reservations } = detail;
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

  const identity = [gearItemKindLabel(t, item.kind), item.size, item.brandModel, item.serialNumber]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <Link
        href={`/shop/${shopSlug}/gear`}
        className="text-sm font-medium text-primary hover:underline"
      >
        {t("gear.unit.backToRegister")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={t("gear.eyebrow")}
          title={item.label}
          description={identity}
          meta={
            deletedAt ? (
              // The one fact that explains the whole page: no forms, and a
              // Restore where the Delete was. "Needs service" is a state of a
              // unit on the wall, so it does not also render here.
              <Badge tone="warning">{t("gear.unit.deleted.badge")}</Badge>
            ) : item.status !== "in_service" ? (
              <Badge tone={item.status === "needs_service" ? "warning" : "neutral"}>
                {gearStatusLabel(t, item.status)}
              </Badge>
            ) : undefined
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

        {/* A deleted unit that was never serviced has an empty card and no
            form to fill it, so it gets no card at all. */}
        {deletedAt && clocks.length === 0 && history.length === 0 ? null : (
          <ServiceCard
            item={item}
            clocks={clocks}
            state={state}
            history={history}
            t={t}
            locale={locale}
            todayLocal={todayLocal}
            readOnly={deletedAt !== null}
          />
        )}

        {settled.length > 0 ? (
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
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}

        {deletedAt ? null : (
          <SectionCard
            id="unit-details"
            padding="lg"
            title={t("gear.unit.details.title")}
            description={t("gear.unit.details.description")}
          >
            <FieldGrid as="form" action={updateGearItemAction} columns={2}>
              <input type="hidden" name="gearItemId" value={item.id} />
              <Field label={t("gear.form.kind")}>
                <select name="kind" className={controlClass} defaultValue={item.kind}>
                  {GEAR_KIND_ORDER.map((option) => (
                    <option key={option} value={option}>
                      {gearItemKindLabel(t, option)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("gear.form.label")} hint={t("gear.form.labelHint")}>
                <input
                  name="label"
                  required
                  maxLength={80}
                  defaultValue={item.label}
                  className={controlClass}
                />
              </Field>
              <Field label={t("gear.form.size")} hint={t("gear.form.optionalHint")}>
                <input
                  name="size"
                  maxLength={40}
                  defaultValue={item.size ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field label={t("gear.form.serialNumber")} hint={t("gear.form.optionalHint")}>
                <input
                  name="serialNumber"
                  maxLength={80}
                  defaultValue={item.serialNumber ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field label={t("gear.form.brandModel")} hint={t("gear.form.optionalHint")}>
                <input
                  name="brandModel"
                  maxLength={120}
                  defaultValue={item.brandModel ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field label={t("gear.form.purchasedOn")} hint={t("gear.form.optionalHint")}>
                <input
                  type="date"
                  name="purchasedOn"
                  defaultValue={item.purchasedOn ?? ""}
                  className={controlClass}
                />
              </Field>
              <FieldActions>
                <SubmitButton
                  pendingLabel={t("gear.unit.details.saving")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("gear.unit.details.save")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </SectionCard>
        )}

        {deletedAt ? (
          <RestoreCard
            item={item}
            deletedAt={deletedAt}
            t={t}
            locale={locale}
            timeZone={shop.timezone}
          />
        ) : (
          <StatusCard item={item} held={held} t={t} />
        )}
      </div>
    </main>
  );
}

/**
 * The unit's clocks and the form that winds them. Logging the work is this
 * page's most frequent act, so its submit is the page's one primary control.
 */
function ServiceCard({
  item,
  clocks,
  state,
  history,
  t,
  locale,
  todayLocal,
  readOnly,
}: {
  item: GearItemDetail["item"];
  clocks: GearItemDetail["clocks"];
  state: ReturnType<typeof gearServiceState>;
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
}) {
  const serviceText =
    !readOnly && (state.state === "due_soon" || state.state === "overdue")
      ? gearServiceStateText(t, state, formatCalendarDate(state.nextDueOn, locale))
      : null;
  return (
    <SectionCard id="service" padding="lg" title={t("gear.unit.service.title")}>
      {/* The urgent clock keeps its urgency on the page where you act on it —
          the register paints this same fact in warning ink, and it must not
          read quieter here. */}
      {serviceText ? (
        <p
          className={`mb-4 text-sm font-medium ${
            state.state === "overdue" ? "text-warning-strong" : "text-muted"
          }`}
        >
          {serviceText}
        </p>
      ) : null}
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

      {readOnly ? null : (
        <FieldGrid as="form" action={recordGearServiceAction} columns={2}>
          <input type="hidden" name="gearItemId" value={item.id} />
          <Field label={t("gear.unit.service.kind")}>
            <select name="kind" className={controlClass}>
              {GEAR_SERVICE_KINDS_FOR[item.kind].map((option) => (
                <option key={option} value={option}>
                  {gearServiceKindLabel(t, option)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("gear.unit.service.servicedOn")}>
            <input
              type="date"
              name="servicedOn"
              required
              defaultValue={todayLocal}
              className={controlClass}
            />
          </Field>
          <Field
            label={t("gear.unit.service.nextDueOn")}
            hint={t("gear.form.optionalHint")}
            description={t("gear.unit.service.nextDueHint")}
          >
            <input type="date" name="nextDueOn" className={controlClass} />
          </Field>
          <Field
            label={t("gear.unit.service.nextDueDives")}
            hint={t("gear.form.optionalHint")}
            description={t("gear.unit.service.nextDueDivesHint")}
          >
            <input
              type="number"
              name="nextDueDives"
              min={1}
              max={9999}
              inputMode="numeric"
              className={controlClass}
            />
          </Field>
          <Field label={t("gear.unit.service.note")} hint={t("gear.form.optionalHint")}>
            <input
              name="note"
              maxLength={500}
              placeholder={t("gear.unit.service.notePlaceholder")}
              className={controlClass}
            />
          </Field>
          {item.status === "needs_service" ? (
            <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="returnToService" defaultChecked className="h-4 w-4" />
              {t("gear.unit.service.returnToService")}
            </label>
          ) : null}
          <FieldActions>
            <SubmitButton pendingLabel={t("gear.unit.service.logging")} className={buttonClass()}>
              {t("gear.unit.service.log")}
            </SubmitButton>
            <FormStatus />
          </FieldActions>
        </FieldGrid>
      )}

      {/* The paper trail rides the card whose clocks it explains, folded —
          the newest event of each kind is already the list above, so at rest
          the history would only repeat it (principle 9). */}
      {history.length > 0 ? (
        // Open on a deleted unit: the history is the whole reason that record
        // is reachable, so folding it would hide what the reader came for.
        <details open={readOnly} className="mt-6 border-t border-border pt-4">
          <summary className="min-h-11 cursor-pointer text-sm font-medium">
            {t("gear.unit.history.title", { count: history.length })}
          </summary>
          <ul className="mt-2 divide-y divide-border">
            {history.map((event) => (
              <li key={event.id} className="py-3">
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

/**
 * The way back, where the Delete was.
 *
 * A deleted unit's record is read-only (`getGearItemDetail` reports the stamp
 * rather than hiding the row), so this card is the page's only control: the
 * day the unit came off the register, and the one act that reverses it. The
 * restore is the register's own action, so a refused one — another unit is
 * wearing this one's tag now — lands on the register beside the fleet that
 * refused it, which is where the collision is.
 */
function RestoreCard({
  item,
  deletedAt,
  t,
  locale,
  timeZone,
}: {
  item: GearItemDetail["item"];
  deletedAt: Date;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  return (
    <SectionCard padding="lg" title={t("gear.unit.status.title")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="w-full text-sm text-muted sm:w-auto sm:flex-1">
          {t("gear.deleted.on", { date: formatShortDate(deletedAt, locale, timeZone) })}
        </p>
        <form action={restoreGearItemAction}>
          <input type="hidden" name="gearItemId" value={item.id} />
          <SubmitButton
            pendingLabel={t("gear.deleted.restoring")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("gear.unit.deleted.restore")}
          </SubmitButton>
        </form>
      </div>
    </SectionCard>
  );
}

/**
 * The two ways a unit leaves the wall: off to the bench, or off the register
 * altogether. `held` is the reservation the delete would strand — present only
 * when the shop has just tried it and been refused, and worded from the page's
 * own read so the holder's name never rides in the URL.
 */
function StatusCard({
  item,
  held,
  t,
}: {
  item: GearItemDetail["item"];
  held: { name: string; until: string } | null;
  t: StaffTranslator;
}) {
  return (
    <SectionCard
      padding="lg"
      title={t("gear.unit.status.title")}
      description={
        item.status === "needs_service" && item.serviceNote ? item.serviceNote : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {item.status === "in_service" ? (
          <FieldGrid as="form" action={setGearItemStatusAction} columns={2}>
            <input type="hidden" name="gearItemId" value={item.id} />
            <input type="hidden" name="status" value="needs_service" />
            <Field label={t("gear.unit.status.pullNote")} hint={t("gear.form.optionalHint")}>
              <input
                name="serviceNote"
                maxLength={300}
                placeholder={t("gear.unit.status.pullNotePlaceholder")}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("gear.unit.status.pulling")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("gear.unit.status.pull")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        ) : (
          <form action={setGearItemStatusAction}>
            <input type="hidden" name="gearItemId" value={item.id} />
            <input type="hidden" name="status" value="in_service" />
            <SubmitButton
              pendingLabel={t("gear.unit.status.reinstating")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("gear.unit.status.reinstate")}
            </SubmitButton>
          </form>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <form action={deleteGearItemAction}>
            <input type="hidden" name="gearItemId" value={item.id} />
            <SubmitButton
              pendingLabel={t("gear.unit.status.deleting")}
              className={buttonClass({ variant: "danger-ghost", size: "sm" })}
            >
              {t("gear.unit.status.delete")}
            </SubmitButton>
          </form>
          <FormStatus>
            {held ? t("gear.unit.status.deleteHeld", { name: held.name, until: held.until }) : null}
          </FormStatus>
        </div>
      </div>
    </SectionCard>
  );
}
