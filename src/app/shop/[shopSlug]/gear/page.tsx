import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard, sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import {
  countCheckedOutGear,
  countGearItemsByKind,
  type GearRegisterRow,
  type GearReturnRow,
  listGearDueBack,
  listGearItems,
  listGearServiceDue,
  listOverdueGearReservations,
} from "@/db/gear";
import { gearItemKindLabel, gearServiceStateText, gearStatusLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  GEAR_KIND_ORDER,
  GEAR_SERVICE_DUE_SOON_DAYS,
  type GearItemKind,
  reservationPhase,
} from "@/lib/gear";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { AddUnitDetails } from "./_components/AddUnitDetails";
import { AddUnitLink } from "./_components/AddUnitLink";
import {
  checkOutGearReservationAction,
  createGearItemAction,
  releaseGearReservationFromRegisterAction,
  restoreGearItemAction,
  returnGearReservationAction,
} from "./actions";

/** `?notice=` codes this page redirects back to itself with. Read through
 * `noticeFromParam`, never a bare `NOTICES[notice]` — the param is
 * attacker-supplied (src/lib/staff-notices.ts). */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  added: { tone: "success", key: "gear.notice.added" },
  restored: { tone: "success", key: "gear.notice.restored" },
  returned: { tone: "success", key: "gear.notice.returned" },
  "checked-out": { tone: "success", key: "gear.notice.checkedOut" },
  released: { tone: "success", key: "gear.notice.released" },
  "already-returned": { tone: "warning", key: "gear.notice.alreadyReturned" },
  "already-checked-out": { tone: "warning", key: "gear.notice.alreadyCheckedOut" },
  "not-found": { tone: "danger", key: "gear.notice.notFound" },
  invalid: { tone: "danger", key: "gear.notice.invalid" },
  "empty-label": { tone: "danger", key: "gear.notice.emptyLabel" },
  "duplicate-label": { tone: "danger", key: "gear.notice.duplicateLabel" },
  "invalid-date": { tone: "danger", key: "gear.notice.invalidDate" },
  deleted: { tone: "success", key: "gear.notice.deleted" },
  updated: { tone: "success", key: "gear.notice.updated" },
  "service-logged": { tone: "success", key: "gear.notice.serviceLogged" },
};

/** Refusals born in the add form render beside it, not in the page banner. */
const NOTICE_FIELD: Record<string, "label" | "purchasedOn"> = {
  "empty-label": "label",
  "duplicate-label": "label",
  "invalid-date": "purchasedOn",
};
const ADD_FORM_NOTICES = new Set(["empty-label", "duplicate-label", "invalid-date"]);

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Gear — DiveDay" };

function parseKind(value: string | undefined): GearItemKind | undefined {
  return GEAR_KIND_ORDER.find((kind) => kind === value);
}

export default async function GearRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    notice?: string;
    page?: string;
    kind?: string;
    undoKind?: string;
    undoLabel?: string;
    undoSize?: string;
    undoSerialNumber?: string;
    undoBrandModel?: string;
    undoPurchasedOn?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const search = await searchParams;
  const { notice, page, kind: kindParam } = search;
  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  const kind = parseKind(kindParam);
  const requestedPage = Number.parseInt(page ?? "", 10);
  const [unitPage, countsByKind, overdue, dueBack, serviceDue, outNow] = await Promise.all([
    listGearItems(db, shop.id, {
      todayLocal,
      kind,
      page: Number.isFinite(requestedPage) ? requestedPage : 1,
    }),
    countGearItemsByKind(db, shop.id),
    listOverdueGearReservations(db, shop.id, todayLocal),
    listGearDueBack(db, shop.id, todayLocal),
    listGearServiceDue(db, shop.id, todayLocal, GEAR_SERVICE_DUE_SOON_DAYS),
    countCheckedOutGear(db, shop.id),
  ]);
  const fleetTotal = [...countsByKind.values()].reduce((sum, value) => sum + value, 0);
  const returns = [...overdue, ...dueBack];

  const banner = noticeFromParam(notice, NOTICES);
  const noticeField = noticeFromParam(notice, NOTICE_FIELD);
  const addStatus = notice && ADD_FORM_NOTICES.has(notice) ? NOTICES[notice] : undefined;
  const pageBanner = noticeField || addStatus ? undefined : banner;
  const fieldError = (field: "label" | "purchasedOn") =>
    noticeField === field && banner ? t(banner.key) : undefined;

  const gearHref = (target: { kind?: GearItemKind; page?: number }) => {
    const query = new URLSearchParams();
    if (target.kind) query.set("kind", target.kind);
    if ((target.page ?? 1) > 1) query.set("page", String(target.page));
    const encoded = query.toString();
    return encoded ? `/shop/${shopSlug}/gear?${encoded}` : `/shop/${shopSlug}/gear`;
  };

  const undo = {
    kind: search.undoKind,
    label: search.undoLabel,
    size: search.undoSize ?? "",
    serialNumber: search.undoSerialNumber ?? "",
    brandModel: search.undoBrandModel ?? "",
    purchasedOn: search.undoPurchasedOn ?? "",
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams
        params={[
          "notice",
          "undoKind",
          "undoLabel",
          "undoSize",
          "undoSerialNumber",
          "undoBrandModel",
          "undoPurchasedOn",
        ]}
      />
      <ShopPageHeader
        eyebrow={t("gear.eyebrow")}
        title={t("gear.title")}
        description={t("gear.description")}
        // An empty register gets no header action: the empty card below is
        // the whole page and owns the one door (principle 8).
        actions={
          fleetTotal === 0 ? undefined : (
            // Secondary: the form below carries the page's one primary.
            <AddUnitLink className={buttonClass({ variant: "secondary" })}>
              <span aria-hidden="true">+</span> {t("gear.addUnit.door")}
            </AddUnitLink>
          )
        }
      />

      {notice === "deleted" && undo.kind && undo.label ? (
        <UndoToast
          message={t("gear.notice.deletedToast")}
          action={restoreGearItemAction}
          fields={{
            kind: undo.kind,
            label: undo.label,
            size: undo.size,
            serialNumber: undo.serialNumber,
            brandModel: undo.brandModel,
            purchasedOn: undo.purchasedOn,
          }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : notice === "returned" && returns.length === 0 && outNow === 0 ? (
        // The earned moment (principles.md #3): the last return of the day
        // closes the loop — one coral line, nothing animated past its 200ms
        // entrance, and only when the queue is genuinely empty.
        <div className="rise-in mt-6 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm font-medium">
          {t("gear.notice.allHome")}
        </div>
      ) : pageBanner ? (
        <StaffNoticeBanner tone={pageBanner.tone}>{t(pageBanner.key)}</StaffNoticeBanner>
      ) : null}

      {/* Three tiles reading 0 / 0 / 0 teach a day-one shop nothing — the
          overview appears once there is a fleet to count, and counts the
          whole fleet, never the filtered page. */}
      {fleetTotal === 0 ? null : (
        <section
          aria-label={t("gear.overviewAriaLabel")}
          className="mb-8 grid gap-3 sm:grid-cols-3"
        >
          <ShopStat
            label={t("gear.stats.outNow")}
            value={outNow}
            detail={t("gear.stats.outNowDetail")}
            // A lagoon-toned zero would spend the action color on "nothing
            // is happening"; the figure earns its tone with a unit out.
            tone={outNow > 0 ? "primary" : undefined}
          />
          <ShopStat
            label={t("gear.stats.dueBack")}
            value={returns.length}
            detail={
              overdue.length > 0
                ? t("gear.stats.dueBackOverdueDetail", { count: overdue.length })
                : t("gear.stats.dueBackDetail")
            }
            tone={overdue.length > 0 ? "warning" : undefined}
          />
          <ShopStat
            label={t("gear.stats.serviceDue")}
            value={serviceDue.length}
            detail={t("gear.stats.serviceDueDetail", { days: GEAR_SERVICE_DUE_SOON_DAYS })}
            tone={serviceDue.some((row) => row.state.state === "overdue") ? "warning" : undefined}
          />
        </section>
      )}

      <div className="space-y-10">
        {returns.length > 0 ? (
          <ReturnsPanel returns={returns} t={t} locale={locale} todayLocal={todayLocal} />
        ) : null}

        {fleetTotal === 0 ? (
          <EmptyState className="mt-4">
            <h2 className="font-semibold">{t("gear.empty.heading")}</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("gear.empty.body")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <AddUnitLink className={buttonClass()}>
                <span aria-hidden="true">+</span> {t("gear.addUnit.door")}
              </AddUnitLink>
            </div>
          </EmptyState>
        ) : (
          <section aria-label={t("gear.fleet.ariaLabel")}>
            <nav aria-label={t("gear.fleet.filterAriaLabel")} className="flex flex-wrap gap-2">
              <Link
                href={gearHref({})}
                aria-current={kind === undefined ? "true" : undefined}
                className={buttonClass({
                  variant: kind === undefined ? "secondary" : "ghost",
                  size: "sm",
                })}
              >
                {t("gear.fleet.filterAll", { count: fleetTotal })}
              </Link>
              {GEAR_KIND_ORDER.filter((option) => (countsByKind.get(option) ?? 0) > 0).map(
                (option) => (
                  <Link
                    key={option}
                    href={gearHref({ kind: option })}
                    aria-current={kind === option ? "true" : undefined}
                    className={buttonClass({
                      variant: kind === option ? "secondary" : "ghost",
                      size: "sm",
                    })}
                  >
                    {t("gear.fleet.filterKind", {
                      label: gearItemKindLabel(t, option),
                      count: countsByKind.get(option) ?? 0,
                    })}
                  </Link>
                ),
              )}
            </nav>

            <div className="mt-4">
              <Table minWidth="45rem">
                {/* Th children go straight into THead — it renders the row
                    itself, and a nested <tr> falls out of the column grid.
                    Kind and Size fold below `sm`: the phone-critical answer
                    is the tag and where it is, and the tag already says the
                    kind ("BCD #2"). */}
                <THead>
                  <Th scope="col">{t("gear.fleet.columns.unit")}</Th>
                  <Th scope="col" hideBelow="sm">
                    {t("gear.fleet.columns.kind")}
                  </Th>
                  <Th scope="col" hideBelow="sm">
                    {t("gear.fleet.columns.size")}
                  </Th>
                  <Th scope="col">{t("gear.fleet.columns.service")}</Th>
                  <Th scope="col">{t("gear.fleet.columns.where")}</Th>
                </THead>
                <TBody>
                  {unitPage.rows.map((row) => (
                    <FleetRow
                      key={row.item.id}
                      row={row}
                      shopSlug={shopSlug}
                      t={t}
                      locale={locale}
                      todayLocal={todayLocal}
                    />
                  ))}
                </TBody>
              </Table>
            </div>
            <Pager
              page={unitPage.page}
              pageCount={unitPage.pageCount}
              href={(target) => gearHref({ kind, page: target })}
              total={t("gear.fleet.pagination.total", { count: unitPage.total })}
              t={t}
              className="mt-4"
            />
          </section>
        )}

        {/* `AddUnitDetails` rather than `SectionCard as="details"` (the shared
            component has no `open` prop, a closed set on purpose) or a plain
            `<details>` (its own React state is what lets `AddUnitLink`
            elsewhere on the page open it reliably — see both components'
            comments). `initialOpen` layers a second, independent reason to
            start open: a refusal from this form to show. */}
        <AddUnitDetails
          className={sectionCardClass({
            padding: "none",
            className: "group/add-unit scroll-mt-24",
          })}
          initialOpen={Boolean(addStatus)}
        >
          <summary
            id="add-unit"
            className="flex min-h-11 scroll-mt-24 cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden sm:p-6"
          >
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{t("gear.addUnit.title")}</h2>
              <p className="mt-1 text-sm text-muted">{t("gear.addUnit.description")}</p>
            </div>
            <DisclosureCaret className="size-4 shrink-0 text-muted group-open/add-unit:rotate-90" />
          </summary>
          <div className="border-t border-border p-5 sm:p-6">
            <FieldGrid as="form" action={createGearItemAction} columns={2}>
              <Field label={t("gear.form.kind")}>
                <select name="kind" className={controlClass} defaultValue="bcd">
                  {GEAR_KIND_ORDER.map((option) => (
                    <option key={option} value={option}>
                      {gearItemKindLabel(t, option)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t("gear.form.label")}
                hint={t("gear.form.labelHint")}
                error={fieldError("label")}
              >
                <input
                  name="label"
                  required
                  maxLength={80}
                  placeholder={t("gear.form.labelPlaceholder")}
                  className={controlClass}
                />
              </Field>
              <Field label={t("gear.form.size")} hint={t("gear.form.optionalHint")}>
                <input
                  name="size"
                  maxLength={40}
                  placeholder={t("gear.form.sizePlaceholder")}
                  className={controlClass}
                />
              </Field>
              <Field label={t("gear.form.serialNumber")} hint={t("gear.form.optionalHint")}>
                <input name="serialNumber" maxLength={80} className={controlClass} />
              </Field>
              <Field label={t("gear.form.brandModel")} hint={t("gear.form.optionalHint")}>
                <input
                  name="brandModel"
                  maxLength={120}
                  placeholder={t("gear.form.brandModelPlaceholder")}
                  className={controlClass}
                />
              </Field>
              <Field
                label={t("gear.form.purchasedOn")}
                hint={t("gear.form.optionalHint")}
                error={fieldError("purchasedOn")}
              >
                <input type="date" name="purchasedOn" className={controlClass} />
              </Field>
              <FieldActions>
                <SubmitButton pendingLabel={t("gear.addUnit.pending")} className={buttonClass()}>
                  {t("gear.addUnit.submit")}
                </SubmitButton>
                <FormStatus tone={addStatus?.tone}>
                  {addStatus && !noticeField ? t(addStatus.key) : null}
                </FormStatus>
              </FieldActions>
            </FieldGrid>
            {/* Keyed on the notice so a repeated refusal re-fires the focus. */}
            <FieldErrorFocus key={notice} scope="add-unit" />
          </div>
        </AddUnitDetails>
      </div>
    </main>
  );
}

/**
 * The units that should be coming through the door: every open reservation
 * whose window ends today or already ended. One tap closes it — the return is
 * the act the whole panel exists for, so it rides each row (principle 10).
 */
function ReturnsPanel({
  returns,
  t,
  locale,
  todayLocal,
}: {
  returns: GearReturnRow[];
  t: StaffTranslator;
  locale: string;
  todayLocal: string;
}) {
  return (
    <SectionCard
      padding="none"
      title={t("gear.returns.title")}
      description={t("gear.returns.description")}
    >
      <ul className="divide-y divide-border">
        {returns.map((row) => {
          // Rows here are open by construction (the readers filter on it).
          const phase = reservationPhase({ ...row, returnedAt: null }, todayLocal);
          return (
            <li
              key={row.reservationId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
            >
              {/* Full first line on phone (basis-full), sharing a row only
                  from `sm` up — three flex children on one 390px line is how
                  the name ran into the amber date. */}
              <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                <p className="font-medium">
                  <span className="font-mono text-sm">{row.label}</span>
                  <span className="text-muted"> · {gearItemKindLabel(t, row.kind)}</span>
                  {row.size ? <span className="text-muted"> · {row.size}</span> : null}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {row.tripTitle
                    ? t("gear.returns.holderWithTrip", {
                        name: row.personName,
                        tripTitle: row.tripTitle,
                      })
                    : t("gear.returns.holder", { name: row.personName })}
                </p>
              </div>
              <p
                className={
                  phase === "overdue"
                    ? "text-sm font-medium text-warning-strong"
                    : "text-sm text-muted"
                }
              >
                {phase === "overdue"
                  ? t("gear.returns.wasDue", {
                      dueOn: formatCalendarDate(row.reservedUntil, locale),
                    })
                  : phase === "never_picked_up"
                    ? t("gear.returns.neverPickedUp", {
                        dueOn: formatCalendarDate(row.reservedUntil, locale),
                      })
                    : t("gear.returns.dueToday")}
              </p>
              {/* The honest close depends on the stamps: a unit that left the
                  counter comes home with a return; one that never left is
                  released (or checked out late) — a fabricated return on a
                  unit still hanging on the wall is the record this branch
                  exists to prevent. */}
              <div className="flex gap-2">
                {row.checkedOutAt === null ? (
                  <>
                    <form action={checkOutGearReservationAction}>
                      <input type="hidden" name="reservationId" value={row.reservationId} />
                      <SubmitButton
                        pendingLabel={t("gear.returns.checkingOut")}
                        className={buttonClass({ variant: "ghost", size: "sm" })}
                      >
                        {t("gear.returns.checkOut")}
                      </SubmitButton>
                    </form>
                    <form action={releaseGearReservationFromRegisterAction}>
                      <input type="hidden" name="reservationId" value={row.reservationId} />
                      <SubmitButton
                        pendingLabel={t("gear.unit.where.releasing")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {t("gear.unit.where.release")}
                      </SubmitButton>
                    </form>
                  </>
                ) : (
                  <form action={returnGearReservationAction}>
                    <input type="hidden" name="reservationId" value={row.reservationId} />
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
  );
}

/** One unit of the fleet. Quiet by default: chrome only for exceptional state. */
function FleetRow({
  row,
  shopSlug,
  t,
  locale,
  todayLocal,
}: {
  row: GearRegisterRow;
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  todayLocal: string;
}) {
  const { item, serviceState, reservation } = row;
  const serviceText =
    serviceState.state === "due_soon" || serviceState.state === "overdue"
      ? gearServiceStateText(t, serviceState, formatCalendarDate(serviceState.nextDueOn, locale))
      : null;
  const phase = reservation ? reservationPhase(reservation, todayLocal) : null;

  return (
    <tr id={`unit-${item.id}`}>
      <Td>
        <Link
          href={`/shop/${shopSlug}/gear/${item.id}`}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {item.label}
        </Link>
        {item.brandModel || item.serialNumber ? (
          <p className="mt-0.5 text-xs text-muted">
            {[item.brandModel, item.serialNumber].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </Td>
      <Td muted hideBelow="sm">
        {gearItemKindLabel(t, item.kind)}
      </Td>
      <Td muted hideBelow="sm">
        {item.size ?? "—"}
      </Td>
      <Td>
        {/* "None is not a status": a healthy unit shows nothing here. */}
        {item.status !== "in_service" ? (
          <Badge tone={item.status === "needs_service" ? "warning" : "neutral"} size="sm">
            {gearStatusLabel(t, item.status)}
          </Badge>
        ) : serviceText ? (
          <span
            className={
              serviceState.state === "overdue"
                ? "text-sm font-medium text-warning-strong"
                : "text-sm text-muted"
            }
          >
            {serviceText}
          </span>
        ) : null}
      </Td>
      <Td>
        {reservation === null || phase === null ? (
          <span className="text-sm text-muted">{t("gear.fleet.inShop")}</span>
        ) : phase === "overdue" ? (
          <span className="text-sm font-medium text-warning-strong">
            {t("gear.fleet.overdueWith", {
              name: reservation.personName,
              dueOn: formatCalendarDate(reservation.reservedUntil, locale),
            })}
          </span>
        ) : phase === "never_picked_up" ? (
          // Quieter than a genuine overdue on purpose: the unit is on the
          // wall — this is a stale claim to release, not a chase.
          <span className="text-sm text-muted">
            {t("gear.fleet.neverPickedUp", { name: reservation.personName })}
          </span>
        ) : phase === "out" || phase === "due_back_today" ? (
          <span className="text-sm">
            {t("gear.fleet.outWith", {
              name: reservation.personName,
              dueOn: formatCalendarDate(reservation.reservedUntil, locale),
            })}
          </span>
        ) : (
          <span className="text-sm text-muted">
            {t("gear.fleet.reservedFor", {
              name: reservation.personName,
              from: formatCalendarDate(reservation.reservedFrom, locale),
            })}
          </span>
        )}
      </Td>
    </tr>
  );
}
