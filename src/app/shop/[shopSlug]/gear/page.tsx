import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { type FilterChip, FilterChips } from "@/components/ui/FilterChips";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { LedgerRow } from "@/components/ui/ledger";
import {
  countGearItemsByKind,
  type DeletedGearItemRow,
  gearRegisterGroups,
  listDeletedGearItems,
  listGearServiceDueRows,
} from "@/db/gear";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { GEAR_KIND_ORDER, type GearItemKind } from "@/lib/gear";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { AddUnitDetails } from "./_components/AddUnitDetails";
import { AddUnitLink } from "./_components/AddUnitLink";
import { GearRegisterLedger, GearServiceDueList } from "./_components/GearRegisterLedger";
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
  "restore-duplicate-label": { tone: "danger", key: "gear.notice.restoreDuplicateLabel" },
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

/**
 * **The gear register, as one story** — ADR 20260827-the-shops-shelves, the
 * instrument pattern. The page is a filter band over three groups that *are*
 * the states (`GearRegisterLedger`), the add-a-unit form, and nothing else.
 *
 * The band's last two chips open the register's two other views, each its own
 * complete list with no groups over it: **Service due**, the fleet-wide answer
 * to what the bench owes, and **Deleted**. Service due is the one reading the
 * three groups do not absorb — the retired stat tiles duplicated Out and Due
 * back, but nothing duplicated the service clock, and a register that could
 * only answer it for the fifty units on the current wall page would be
 * promising something in its own description that it no longer does.
 *
 * The register stays opt-in by presence (ADR 20260815-minimal-gear-register):
 * a shop with zero units gets the empty state and its one door — no groups, no
 * kind chips, no earned line, and no header action.
 */
export default async function GearRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    notice?: string;
    page?: string;
    kind?: string;
    view?: string;
    undoId?: string;
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
  const wantedPage = Number.isFinite(requestedPage) ? requestedPage : 1;
  // The one view that leaves the live fleet behind. Its own paging, so a long
  // register and a long list of deleted units never share a page number.
  const deletedView = search.view === "deleted";
  // The register's other view that leaves the groups behind: what the bench
  // owes, fleet-wide and unpaged. Read on every request rather than only when
  // asked for, because its chip states the count (`listGearServiceDueRows`).
  const serviceView = search.view === "service";
  const [groups, deletedPage, countsByKind, serviceDue] = await Promise.all([
    gearRegisterGroups(db, shop.id, {
      todayLocal,
      kind,
      page: deletedView || serviceView ? 1 : wantedPage,
    }),
    listDeletedGearItems(db, shop.id, { page: deletedView ? wantedPage : 1 }),
    countGearItemsByKind(db, shop.id),
    listGearServiceDueRows(db, shop.id, { todayLocal }),
  ]);
  const fleetTotal = [...countsByKind.values()].reduce((sum, value) => sum + value, 0);
  // A view with nothing in it is not a view: an empty Deleted list falls back
  // to the fleet rather than rendering a heading over nothing. A shop that has
  // deleted its whole fleet lands here whether it asked to or not — otherwise
  // the empty state would be the only thing left and the units unreachable.
  const showDeleted = deletedPage.total > 0 && (deletedView || fleetTotal === 0);
  // Same rule one line up: a view with nothing in it is not a view. A shop
  // whose whole fleet is in date lands back on the register rather than on a
  // heading over nothing — and its chip is not there to click in the first
  // place, so this only catches a hand-typed or stale URL.
  const showService = !showDeleted && serviceView && serviceDue.length > 0;
  // The register's one coral moment (ADR 20260827-clearwater-surface-language,
  // decision 11): units on the register, nothing out, nothing overdue. Derived
  // from the groups themselves, so it can never disagree with them, and it
  // only plays its entrance for the reader who just closed the last one.
  //
  // **Never under a kind filter.** The groups narrow with the chips, so "all
  // home" on the Tanks view would be claiming something about the whole
  // register while a regulator is overdue one chip away.
  const allHome =
    !showDeleted &&
    !showService &&
    kind === undefined &&
    fleetTotal > 0 &&
    groups.out.length === 0 &&
    groups.overdue.length === 0;

  const banner = noticeFromParam(notice, NOTICES);
  const noticeField = noticeFromParam(notice, NOTICE_FIELD);
  const addStatus = notice && ADD_FORM_NOTICES.has(notice) ? NOTICES[notice] : undefined;
  // "Marked returned — the unit is home." and the earned line say the same
  // thing; when the register has earned the line, the line is the better half.
  const pageBanner =
    noticeField || addStatus || (allHome && notice === "returned") ? undefined : banner;
  const fieldError = (field: "label" | "purchasedOn") =>
    noticeField === field && banner ? t(banner.key) : undefined;

  const gearHref = (target: {
    kind?: GearItemKind;
    page?: number;
    deleted?: boolean;
    service?: boolean;
  }) => {
    const query = new URLSearchParams();
    if (target.deleted) query.set("view", "deleted");
    if (target.service) query.set("view", "service");
    if (target.kind) query.set("kind", target.kind);
    if ((target.page ?? 1) > 1) query.set("page", String(target.page));
    const encoded = query.toString();
    return encoded ? `/shop/${shopSlug}/gear?${encoded}` : `/shop/${shopSlug}/gear`;
  };

  const chips: FilterChip[] = [];
  if (fleetTotal > 0) {
    chips.push({
      key: "all",
      href: gearHref({}),
      active: !showDeleted && !showService && kind === undefined,
      label: t("gear.fleet.filterAll", { count: fleetTotal }),
    });
    for (const option of GEAR_KIND_ORDER) {
      const count = countsByKind.get(option) ?? 0;
      if (count === 0) continue;
      chips.push({
        key: option,
        href: gearHref({ kind: option }),
        active: !showDeleted && !showService && kind === option,
        label: t("gear.fleet.filterKind", { label: gearItemKindLabel(t, option), count }),
      });
    }
  }
  // The one reading no group owns: what the bench owes across the whole fleet,
  // not just the wall page in front of you. It appears only when something is
  // actually due — three tiles reading 0 taught a day-one shop nothing, and
  // neither does a chip promising a list with nothing in it.
  if (serviceDue.length > 0) {
    chips.push({
      key: "service-due",
      href: gearHref({ service: true }),
      active: showService,
      label: t("gear.fleet.serviceDue.filter", { count: serviceDue.length }),
    });
  }
  // The way back to a deleted unit, and the only one: it is off the fleet, off
  // every picker, and its own URL is a 404.
  if (deletedPage.total > 0) {
    chips.push({
      key: "deleted",
      href: gearHref({ deleted: true }),
      active: showDeleted,
      label: t("gear.deleted.filter", { count: deletedPage.total }),
    });
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "undoId"]} />
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

      {notice === "deleted" && search.undoId ? (
        <UndoToast
          message={t("gear.notice.deleted")}
          action={restoreGearItemAction}
          fields={{ gearItemId: search.undoId }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : pageBanner ? (
        <StaffNoticeBanner tone={pageBanner.tone}>{t(pageBanner.key)}</StaffNoticeBanner>
      ) : null}

      <div className="space-y-10">
        {fleetTotal === 0 && !showDeleted ? (
          <EmptyState
            title={t("gear.empty.heading")}
            action={
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <AddUnitLink className={buttonClass()}>
                  <span aria-hidden="true">+</span> {t("gear.addUnit.door")}
                </AddUnitLink>
              </div>
            }
            className="mt-4"
          />
        ) : (
          <section
            aria-label={
              showDeleted
                ? t("gear.deleted.title")
                : showService
                  ? t("gear.fleet.serviceDue.title")
                  : t("gear.fleet.ariaLabel")
            }
          >
            {chips.length > 0 ? (
              <FilterChips label={t("gear.fleet.filterAriaLabel")} chips={chips} />
            ) : null}

            {showDeleted ? (
              <>
                <DeletedList
                  rows={deletedPage.rows}
                  shopSlug={shopSlug}
                  t={t}
                  locale={locale}
                  timeZone={shop.timezone}
                />
                <Pager
                  page={deletedPage.page}
                  pageCount={deletedPage.pageCount}
                  href={(target) => gearHref({ deleted: true, page: target })}
                  total={t("gear.fleet.pagination.total", { count: deletedPage.total })}
                  t={t}
                  className="mt-4"
                />
              </>
            ) : showService ? (
              <GearServiceDueList
                rows={serviceDue}
                shopSlug={shopSlug}
                t={t}
                locale={locale}
                timeZone={shop.timezone}
                todayLocal={todayLocal}
                returnAction={returnGearReservationAction}
                checkOutAction={checkOutGearReservationAction}
                releaseAction={releaseGearReservationFromRegisterAction}
              />
            ) : (
              <div className="mt-6">
                <GearRegisterLedger
                  groups={groups}
                  shopSlug={shopSlug}
                  t={t}
                  locale={locale}
                  timeZone={shop.timezone}
                  todayLocal={todayLocal}
                  allHome={allHome}
                  celebrate={notice === "returned"}
                  pageHref={(target) => gearHref({ kind, page: target })}
                  returnAction={returnGearReservationAction}
                  checkOutAction={checkOutGearReservationAction}
                  releaseAction={releaseGearReservationFromRegisterAction}
                />
              </div>
            )}
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
 * The units that have been deleted, newest first, each with the one act this
 * list exists for. The same ledger rows as the register above, with no group
 * heading over them: the active Deleted chip is what says which view this is,
 * and repeating the word underneath it would be the shared fact said twice
 * (ADR 20260827-the-shops-shelves).
 *
 * The row is a door to the unit's own record, which reads as a read-only
 * history while the unit is deleted (issue #614) — so "when was this last
 * serviced" no longer costs a restore-and-delete round trip.
 */
function DeletedList({
  rows,
  shopSlug,
  t,
  locale,
  timeZone,
}: {
  rows: DeletedGearItemRow[];
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  return (
    <ul className="mt-6">
      {rows.map((row) => (
        <LedgerRow
          key={row.id}
          href={`/shop/${shopSlug}/gear/${row.id}`}
          linkLabel={row.label}
          trailing={
            <form action={restoreGearItemAction}>
              <input type="hidden" name="gearItemId" value={row.id} />
              <SubmitButton
                ariaLabel={t("gear.deleted.restoreUnit", { label: row.label })}
                pendingLabel={t("gear.deleted.restoring")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("gear.deleted.restore")}
              </SubmitButton>
            </form>
          }
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <span className="font-mono text-sm font-medium">{row.label}</span>
            <span className="text-sm text-muted">
              {[gearItemKindLabel(t, row.kind), row.size].filter(Boolean).join(" · ")}
            </span>
            <span className="text-sm text-muted">
              {t("gear.deleted.on", { date: formatShortDate(row.deletedAt, locale, timeZone) })}
            </span>
          </div>
        </LedgerRow>
      ))}
    </ul>
  );
}
