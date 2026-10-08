import type { Metadata } from "next";
import Link from "next/link";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import {
  ChoiceFieldset,
  ChoicePill,
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import { canPersonManageOrders } from "@/db/authz";
import { listDiverSummaries } from "@/db/divers";
import { countGearItems, listAvailableGearUnits } from "@/db/gear";
import { counterRentalPerson } from "@/db/gear-counter-rentals";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  checkCounterRentalWindow,
  counterRentalDays,
  counterRentalLineCents,
} from "@/lib/counter-rentals";
import { GEAR_KIND_ORDER, type GearItemKind } from "@/lib/gear";
import { currencyFractionDigits, minorToMajor, toShopCurrency } from "@/lib/money";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { InvoiceAddressFields } from "../../../orders/_components/InvoiceAddressFields";
import { createCounterRentalAction } from "../actions";
import { PRICE_FIELD_PREFIX, UNIT_FIELD } from "../rental-form";
import { RentalPersonStep } from "./_components/RentalPersonStep";

export const instant = true;

export const metadata: Metadata = {
  title: "Rent out — DiveDay",
  robots: { index: false, follow: false },
};

/** Where a refusal belongs: beside the person step, or beside the submit. */
type NoticeDefinition = { key: StaffMessageKey; step: "who" | "rent" };

const NOTICES: Record<string, NoticeDefinition> = {
  invalid: { key: "counterRentals.new.notice.invalid", step: "rent" },
  duplicate: { key: "counterRentals.new.notice.duplicate", step: "who" },
  "invalid-window": { key: "counterRentals.new.notice.invalidWindow", step: "rent" },
  "starts-in-past": { key: "counterRentals.new.notice.startsInPast", step: "rent" },
  "window-too-long": { key: "counterRentals.new.notice.windowTooLong", step: "rent" },
  "no-units": { key: "counterRentals.new.notice.noUnits", step: "rent" },
  "too-many-units": { key: "counterRentals.new.notice.tooManyUnits", step: "rent" },
  "person-not-found": { key: "counterRentals.new.notice.personNotFound", step: "who" },
  "unit-not-found": { key: "counterRentals.new.notice.unitNotFound", step: "rent" },
  "unit-out-of-service": { key: "counterRentals.new.notice.unitOutOfService", step: "rent" },
  "unit-unavailable": { key: "counterRentals.new.notice.unitUnavailableUnnamed", step: "rent" },
  "not-authorized": { key: "counterRentals.new.notice.notAuthorized", step: "rent" },
  "payment-not-connected": { key: "counterRentals.new.notice.paymentNotConnected", step: "rent" },
  "needs-email": { key: "counterRentals.new.notice.needsEmail", step: "rent" },
};

/**
 * **Rent out** — lend units from the register to somebody who is not on a
 * boat (ADR 20260815-minimal-gear-register, amended 2026-10-08).
 *
 * Three steps on one page, each a plain form whose answer rides in the URL:
 * who (find them, or put them on file), when (the window, shop-local dates),
 * then which units are free for the whole of it and what to charge. A refusal
 * lands back on the same URL with its `?notice=`, so nothing already chosen
 * is lost. The list of free units is advisory — the exclusion constraint
 * decides at submit, and the refusal names the unit that lost.
 *
 * Any staff may rent gear out (H-06). The invoice beside it is shown only to
 * the people who may send one, on a shop that can take payment, for a person
 * with an email to send it to; the action re-checks all three.
 */
export default async function RentOutPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    personId?: string;
    q?: string;
    from?: string;
    until?: string;
    notice?: string;
    unit?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const search = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);

  const personId = uuidParam(search.personId);
  const query = search.q?.trim() ?? "";
  const from = search.from && isValidCalendarDate(search.from) ? search.from : todayLocal;
  const until = search.until && isValidCalendarDate(search.until) ? search.until : from;
  const windowRefusal = checkCounterRentalWindow({ from, until, todayLocal });

  const [person, fleetSize, matches] = await Promise.all([
    personId ? counterRentalPerson(db, shop.id, personId) : null,
    countGearItems(db, shop.id),
    !personId && query
      ? listDiverSummaries(db, shop.id, { query, limit: 6, timeZone: shop.timezone })
      : null,
  ]);
  const [units, canInvoice] = person
    ? await Promise.all([
        windowRefusal ? [] : listAvailableGearUnits(db, shop.id, { from, until, todayLocal }),
        (async () =>
          (await canPersonManageOrders(db, shop.id, session.user.personId)) &&
          canAcceptPayments(await getShopStripeAccount(db, shop.id)))(),
      ])
    : [[], false];

  const notice = noticeFromParam(search.notice, NOTICES);
  const noticeText = notice
    ? search.notice === "unit-unavailable" && search.unit
      ? t("counterRentals.new.notice.unitUnavailable", { label: search.unit })
      : t(notice.key)
    : undefined;
  const whoNotice = notice?.step === "who" || !person ? noticeText : undefined;
  const rentNotice = person && notice?.step === "rent" ? noticeText : undefined;

  const currency = toShopCurrency(shop.currency);
  const digits = currencyFractionDigits(currency);
  const step = digits === 0 ? "1" : `0.${"0".repeat(digits - 1)}1`;
  const days = counterRentalDays(from, until);
  const priceOf = (kind: GearItemKind) => {
    const cents = counterRentalLineCents(shop.rentalPricing, kind, days);
    return cents === null ? "" : minorToMajor(cents, currency).toFixed(digits);
  };
  const byKind = GEAR_KIND_ORDER.map((kind) => ({
    kind,
    units: units.filter((unit) => unit.kind === kind),
  })).filter((group) => group.units.length > 0);
  const invoiceOffered = canInvoice && Boolean(person?.email);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "unit"]} />
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.gear)}
        eyebrowHref={shopPath(shopSlug, "gear")}
        title={t("counterRentals.new.title")}
      />

      <div className="space-y-10">
        <RentalPersonStep
          t={t}
          shopSlug={shopSlug}
          person={person}
          query={query}
          matches={matches}
          from={from}
          until={until}
          whoNotice={whoNotice}
        />

        {person ? (
          <SectionCard title={t("counterRentals.new.whenHeading")}>
            <FieldGrid as="form" method="get" columns={2}>
              <input type="hidden" name="personId" value={person.id} />
              <Field label={t("counterRentals.new.fromLabel")}>
                <DateField name="from" defaultValue={from} min={todayLocal} required />
              </Field>
              <Field label={t("counterRentals.new.untilLabel")}>
                <DateField name="until" defaultValue={until} min={todayLocal} required />
              </Field>
              <FieldActions>
                <button type="submit" className={buttonClass({ variant: "secondary" })}>
                  {t("counterRentals.new.showUnits")}
                </button>
                {windowRefusal ? (
                  <FormStatus tone="danger">
                    {t(
                      windowRefusal === "starts_in_past"
                        ? "counterRentals.new.notice.startsInPast"
                        : windowRefusal === "window_too_long"
                          ? "counterRentals.new.notice.windowTooLong"
                          : "counterRentals.new.notice.invalidWindow",
                    )}
                  </FormStatus>
                ) : (
                  <span className="text-sm text-muted">
                    {t("counterRentals.new.days", { count: days })}
                  </span>
                )}
              </FieldActions>
            </FieldGrid>
          </SectionCard>
        ) : null}

        {person && !windowRefusal ? (
          <form action={createCounterRentalAction} className="flex flex-col gap-6">
            <input type="hidden" name="personId" value={person.id} />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="until" value={until} />
            <SectionCard>
              {fleetSize === 0 ? (
                <p className="text-sm text-muted">
                  {t("counterRentals.new.noFleet")}{" "}
                  <Link
                    href={shopPath(shopSlug, "gear")}
                    className={buttonClass({ variant: "link", size: "sm", flush: true })}
                  >
                    {t(STAFF_DESTINATION_LABEL_KEYS.gear)}
                  </Link>
                </p>
              ) : byKind.length === 0 ? (
                <p className="text-sm text-muted">{t("counterRentals.new.noUnits")}</p>
              ) : (
                <ChoiceFieldset
                  legend={t("counterRentals.new.unitsLegend")}
                  bodyClassName="flex flex-col gap-5"
                >
                  {byKind.map((group) => (
                    <div key={group.kind}>
                      <p className="text-sm text-muted">{gearItemKindLabel(t, group.kind)}</p>
                      <div className="mt-2 flex flex-col gap-2">
                        {group.units.map((unit) => {
                          const care = [
                            unit.serviceState.state === "overdue"
                              ? t("gear.prep.optionServiceOverdue")
                              : null,
                            unit.serviceConcern ? t("gear.prep.optionServiceConcern") : null,
                            unit.serviceState.state === "due_soon"
                              ? t("gear.prep.optionServiceDueSoon")
                              : null,
                          ].filter(Boolean);
                          const words = (
                            <>
                              <span className="font-medium">{unit.label}</span>
                              {unit.size ? (
                                <span className="text-muted"> · {unit.size}</span>
                              ) : null}
                              {care.length > 0 ? (
                                <span className="text-warning-strong"> · {care.join(" · ")}</span>
                              ) : null}
                            </>
                          );
                          return invoiceOffered ? (
                            <ChoicePill
                              key={unit.id}
                              type="checkbox"
                              name={UNIT_FIELD}
                              value={unit.id}
                              aside={
                                <input
                                  type="number"
                                  name={`${PRICE_FIELD_PREFIX}${unit.id}`}
                                  min={0}
                                  step={step}
                                  defaultValue={priceOf(unit.kind)}
                                  aria-label={t("counterRentals.new.priceAria", {
                                    label: unit.label,
                                  })}
                                  className={`${controlClass} w-28 shrink-0`}
                                />
                              }
                            >
                              {words}
                            </ChoicePill>
                          ) : (
                            <ChoiceRow
                              key={unit.id}
                              type="checkbox"
                              name={UNIT_FIELD}
                              value={unit.id}
                            >
                              {words}
                            </ChoiceRow>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </ChoiceFieldset>
              )}
            </SectionCard>

            {canInvoice && byKind.length > 0 ? (
              <SectionCard title={t("counterRentals.new.invoiceLegend")}>
                {invoiceOffered ? (
                  <div className="flex flex-col gap-4">
                    <ChoiceRow type="checkbox" name="invoice" defaultChecked>
                      {t("counterRentals.new.sendInvoice")}
                    </ChoiceRow>
                    {shop.taxEnabled ? (
                      <InvoiceAddressFields
                        t={t}
                        demoAddress={shop.isDemo ? shop : null}
                        className="rounded-lg border border-border p-4"
                      />
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted">{t("counterRentals.new.noEmail")}</p>
                )}
              </SectionCard>
            ) : null}

            {byKind.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton
                  pendingLabel={t("counterRentals.new.submitting")}
                  className={buttonClass()}
                >
                  {t("counterRentals.new.submit")}
                </SubmitButton>
                <FormStatus tone="danger">{rentNotice}</FormStatus>
              </div>
            ) : (
              <FormStatus tone="danger">{rentNotice}</FormStatus>
            )}
          </form>
        ) : null}
      </div>
    </main>
  );
}
