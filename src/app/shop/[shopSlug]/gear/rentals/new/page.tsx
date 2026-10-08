import type { Metadata } from "next";
import Link from "next/link";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import {
  ChoiceRow,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import { canPersonManageOrders } from "@/db/authz";
import { listDiverSummaries } from "@/db/divers";
import { countGearItems, listAvailableGearUnits } from "@/db/gear";
import {
  counterRentalCards,
  counterRentalPerson,
  counterRentalUnitLabel,
} from "@/db/gear-counter-rentals";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { isMinorOnDate } from "@/lib/age";
import { calendarDateInTimezone, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  checkCounterRentalWindow,
  counterRentalCardRefusal,
  counterRentalCardSummary,
  counterRentalCoreKinds,
  counterRentalDays,
  counterRentalLineCents,
  isLifeSupportKind,
} from "@/lib/counter-rentals";
import { GEAR_KIND_ORDER, type GearItemKind, gearServiceKeepsUnitBack } from "@/lib/gear";
import { currencyFractionDigits, minorToMajor, toShopCurrency } from "@/lib/money";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { InvoiceAddressFields } from "../../../orders/_components/InvoiceAddressFields";
import { createCounterRentalAction } from "../actions";
import { CounterUnitPicker, type PickerUnit } from "./_components/CounterUnitPicker";
import { RentalCardSeen } from "./_components/RentalCardSeen";
import { RentalPersonStep } from "./_components/RentalPersonStep";

export const instant = true;

export const metadata: Metadata = {
  title: "Rent out — DiveDay",
  robots: { index: false, follow: false },
};

/** Where a refusal belongs: beside the person step, or beside the submit. */
type NoticeDefinition = {
  key: StaffMessageKey;
  step: "who" | "rent";
  /** The same sentence naming the unit, when the refusal carries one (`?unit=`). */
  named?: StaffMessageKey;
  tone?: NoticeTone;
};

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
  "unit-unavailable": {
    key: "counterRentals.new.notice.unitUnavailableUnnamed",
    named: "counterRentals.new.notice.unitUnavailable",
    step: "rent",
  },
  "unit-needs-service": {
    key: "counterRentals.new.notice.unitNeedsServiceUnnamed",
    named: "counterRentals.new.notice.unitNeedsService",
    step: "rent",
  },
  "unit-needs-confirm": {
    key: "counterRentals.new.notice.unitNeedsConfirmUnnamed",
    named: "counterRentals.new.notice.unitNeedsConfirm",
    step: "rent",
  },
  "not-certified": { key: "counterRentals.new.notice.notCertified", step: "who" },
  "no-drysuit-card": { key: "counterRentals.new.notice.noDrysuitCard", step: "who" },
  "card-recorded": { key: "counterRentals.new.notice.cardRecorded", step: "who", tone: "success" },
  "card-duplicate": { key: "counterRentals.new.notice.cardDuplicate", step: "who" },
  "card-not-recorded": { key: "counterRentals.new.notice.cardNotRecorded", step: "who" },
  "card-invalid": { key: "counterRentals.new.notice.cardInvalid", step: "who" },
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

  const noticeUnitId = uuidParam(search.unit);
  const [person, fleetSize, matches, cards, noticeUnit] = await Promise.all([
    personId ? counterRentalPerson(db, shop.id, personId) : null,
    countGearItems(db, shop.id),
    !personId && query
      ? listDiverSummaries(db, shop.id, { query, limit: 6, timeZone: shop.timezone })
      : null,
    personId ? counterRentalCards(db, shop.id, personId) : null,
    // The URL carries a unit id, never words: the label is this shop's own,
    // looked up here, and an id that is not one falls back to the unnamed line.
    noticeUnitId ? counterRentalUnitLabel(db, shop.id, noticeUnitId) : null,
  ]);
  const [units, canInvoice] = person
    ? await Promise.all([
        windowRefusal
          ? []
          : listAvailableGearUnits(db, shop.id, { from, until, todayLocal, serviceAsOf: until }),
        (async () =>
          (await canPersonManageOrders(db, shop.id, session.user.personId)) &&
          canAcceptPayments(await getShopStripeAccount(db, shop.id)))(),
      ])
    : [[], false];

  const notice = noticeFromParam(search.notice, NOTICES);
  const noticeText = notice
    ? notice.named && noticeUnit
      ? t(notice.named, { label: noticeUnit })
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
  const invoiceOffered = canInvoice && Boolean(person?.email);
  const cardSummary = cards ? counterRentalCardSummary(cards) : null;
  // Each unit judged as the action will judge it: the card rule for its kind,
  // then its service record read on the window's last day. Blocked units are
  // shown (so nobody wonders where the regulators went) but cannot be ticked;
  // flagged soft goods sort last and ask for their own "lend anyway".
  const pickerUnit = (unit: (typeof units)[number]): PickerUnit & { order: number } => {
    const flagged = gearServiceKeepsUnitBack(unit);
    const cardRefusal = cards ? counterRentalCardRefusal([unit.kind], cards) : null;
    const blocked = cardRefusal
      ? t(
          cardRefusal === "no_drysuit_card"
            ? "counterRentals.new.unitNeedsDrysuitCard"
            : "counterRentals.new.unitNeedsCard",
        )
      : flagged && isLifeSupportKind(unit.kind)
        ? t("counterRentals.new.unitNeedsService")
        : null;
    return {
      id: unit.id,
      kind: unit.kind,
      label: unit.label,
      size: unit.size,
      care: [
        unit.serviceState.state === "overdue" ? t("gear.prep.optionServiceOverdue") : null,
        unit.serviceConcern ? t("gear.prep.optionServiceConcern") : null,
        unit.serviceState.state === "due_soon" ? t("gear.prep.optionServiceDueSoon") : null,
      ].filter((word): word is string => word !== null),
      blocked,
      confirmLabel:
        flagged && !blocked ? t("counterRentals.new.lendAnyway", { label: unit.label }) : null,
      price: priceOf(unit.kind),
      priceAria: t("counterRentals.new.priceAria", { label: unit.label }),
      order: blocked ? 2 : flagged ? 1 : 0,
    };
  };
  const byKind = GEAR_KIND_ORDER.map((kind) => ({
    kind,
    kindLabel: gearItemKindLabel(t, kind),
    units: units
      .filter((unit) => unit.kind === kind)
      .map(pickerUnit)
      .sort((a, b) => a.order - b.order),
  })).filter((group) => group.units.length > 0);
  const setPrice =
    shop.rentalPricing.setCents === null
      ? null
      : minorToMajor(shop.rentalPricing.setCents * days, currency).toFixed(digits);

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
          whoTone={notice?.tone}
          cards={
            person && cardSummary ? (
              <RentalCardSeen
                t={t}
                personId={person.id}
                from={from}
                until={until}
                summary={cardSummary}
                minor={Boolean(person.dateOfBirth && isMinorOnDate(person.dateOfBirth, from))}
                drysuitOnOffer={units.some((unit) => unit.kind === "drysuit")}
              />
            ) : null
          }
        />

        {person ? (
          <SectionCard title={t("counterRentals.new.whenHeading")}>
            <FieldGrid as="form" method="get" columns={2}>
              <input type="hidden" name="personId" value={person.id} />
              <Field label={t("counterRentals.new.fromLabel")}>
                <DateField name="from" defaultValue={from} min={todayLocal} required />
              </Field>
              <Field label={t("counterRentals.new.untilLabel")}>
                <DateField name="until" defaultValue={until} min={from} required />
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
                <CounterUnitPicker
                  legend={t("counterRentals.new.unitsLegend")}
                  groups={byKind}
                  withPrices={invoiceOffered}
                  step={step}
                  coreKinds={counterRentalCoreKinds(shop.rentalItems)}
                  setPrice={setPrice}
                  setLabel={t("counterRentals.new.setPrice", { count: days })}
                />
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
