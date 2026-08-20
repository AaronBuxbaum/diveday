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
import {
  GEAR_KIND_ORDER,
  GEAR_SERVICE_KINDS_FOR,
  gearServiceState,
  reservationPhase,
} from "@/lib/gear";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
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
  invalid: { tone: "danger", key: "gear.notice.invalid" },
  "empty-label": { tone: "danger", key: "gear.notice.emptyLabel" },
  "duplicate-label": { tone: "danger", key: "gear.notice.duplicateLabel" },
  "invalid-date": { tone: "danger", key: "gear.notice.invalidDate" },
  "due-not-after-service": { tone: "danger", key: "gear.notice.dueNotAfterService" },
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
  const openReservations = reservations.filter((reservation) => !reservation.returnedAt);
  const settled = reservations.filter((reservation) => reservation.returnedAt);

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
            item.status !== "in_service" ? (
              <Badge tone={item.status === "needs_service" ? "warning" : "neutral"}>
                {gearStatusLabel(t, item.status)}
              </Badge>
            ) : undefined
          }
        />
      </div>

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

      <div className="mt-8 space-y-10">
        {/* Eight words don't need a card of their own: the panel exists only
            when there are reservations carrying actions. */}
        {openReservations.length === 0 ? (
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

        <ServiceCard
          item={item}
          clocks={clocks}
          state={state}
          history={history}
          t={t}
          locale={locale}
          todayLocal={todayLocal}
        />

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

        <StatusCard item={item} t={t} />
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
}: {
  item: GearItemDetail["item"];
  clocks: GearItemDetail["clocks"];
  state: ReturnType<typeof gearServiceState>;
  history: GearItemDetail["history"];
  t: StaffTranslator;
  locale: string;
  todayLocal: string;
}) {
  const serviceText =
    state.state === "due_soon" || state.state === "overdue"
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
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-sm text-muted">{t("gear.unit.service.noClocks")}</p>
      )}

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

      {/* The paper trail rides the card whose clocks it explains, folded —
          the newest event of each kind is already the list above, so at rest
          the history would only repeat it (principle 9). */}
      {history.length > 0 ? (
        <details className="mt-6 border-t border-border pt-4">
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
 * The three ways a unit leaves the wall, gentlest first. Retiring keeps the
 * history; deleting is for rows that never should have existed, and says so.
 */
function StatusCard({ item, t }: { item: GearItemDetail["item"]; t: StaffTranslator }) {
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
          {item.status !== "retired" ? (
            <form action={setGearItemStatusAction}>
              <input type="hidden" name="gearItemId" value={item.id} />
              <input type="hidden" name="status" value="retired" />
              <SubmitButton
                pendingLabel={t("gear.unit.status.retiring")}
                className={buttonClass({ variant: "ghost", size: "sm" })}
              >
                {t("gear.unit.status.retire")}
              </SubmitButton>
            </form>
          ) : null}
          <form action={deleteGearItemAction}>
            <input type="hidden" name="gearItemId" value={item.id} />
            <SubmitButton
              pendingLabel={t("gear.unit.status.deleting")}
              className={buttonClass({ variant: "danger-ghost", size: "sm" })}
            >
              {t("gear.unit.status.delete")}
            </SubmitButton>
          </form>
          <p className="text-xs text-muted">{t("gear.unit.status.deleteWarning")}</p>
        </div>
      </div>
    </SectionCard>
  );
}
