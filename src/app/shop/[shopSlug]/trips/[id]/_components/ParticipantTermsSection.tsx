import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { staffParticipantTypeLabel } from "@/i18n/participant-labels";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import {
  currencyFractionDigits,
  maxPriceMajor,
  minorToMajor,
  type ShopCurrency,
  toShopCurrency,
} from "@/lib/money";
import { MAX_DIVER_SEATS } from "@/lib/participant-terms";
import { diverSeatLimit } from "@/lib/participant-types";
import { type FormNotice, noticeForForm } from "@/lib/staff-notices";
import { saveParticipantTermsAction } from "../actions";
import type { TripAboutRow } from "./TripAboutSection";
import type { Trip } from "./types";

/**
 * The one line the Details row shows when the editor is folded: each non-diver
 * price this departure sells, and the diver limit when one binds, or "Divers
 * only" when it sells neither.
 */
export function participantTermsSummary(
  t: StaffTranslator,
  trip: Pick<Trip, "snorkelerPriceCents" | "riderPriceCents" | "diverCapacity" | "capacity">,
  currency: ShopCurrency,
  locale: string,
): string {
  const price = (cents: number) =>
    cents === 0 ? t("participants.terms.free") : formatMoneyCents(cents, currency, locale);
  const parts: string[] = [];
  if (trip.snorkelerPriceCents !== null) {
    parts.push(
      t("participants.terms.priceLine", {
        type: staffParticipantTypeLabel(t, "snorkeler"),
        price: price(trip.snorkelerPriceCents),
      }),
    );
  }
  if (trip.riderPriceCents !== null) {
    parts.push(
      t("participants.terms.priceLine", {
        type: staffParticipantTypeLabel(t, "rider"),
        price: price(trip.riderPriceCents),
      }),
    );
  }
  const limit = diverSeatLimit(trip);
  if (limit !== null) parts.push(t("participants.terms.diverSeatsLine", { count: limit }));
  return parts.length > 0 ? parts.join(" · ") : t("participants.terms.divesOnly");
}

/**
 * A departure's terms for snorkelers and riders (ADR
 * 20261007-participant-types): their two prices and how many seats may dive.
 * Its own form rather than three more boxes on Details, so a shop that never
 * carries a snorkeler never meets them.
 */
export function ParticipantTermsSection({
  action,
  status,
  trip,
  currency,
  locale,
}: {
  action: (formData: FormData) => void;
  /** This form's own outcome, rendered beside its Save button. */
  status?: FormNotice;
  trip: Trip;
  currency: ShopCurrency;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const digits = currencyFractionDigits(currency);
  const priceStep = digits === 0 ? "1" : `0.${"0".repeat(digits - 1)}1`;
  const pricePlaceholder = formatMoneyCents(0, currency, locale);
  const priceValue = (cents: number | null) =>
    cents === null ? "" : minorToMajor(cents, currency);
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("participants.terms.description")}</p>
      <FieldGrid columns={3}>
        <Field label={t("participants.terms.snorkelerPrice")}>
          <input
            name="snorkelerPrice"
            type="number"
            step={priceStep}
            min={0}
            max={maxPriceMajor(currency)}
            placeholder={pricePlaceholder}
            defaultValue={priceValue(trip.snorkelerPriceCents)}
            className={`${controlClass} tabular-nums`}
          />
        </Field>
        <Field label={t("participants.terms.riderPrice")}>
          <input
            name="riderPrice"
            type="number"
            step={priceStep}
            min={0}
            max={maxPriceMajor(currency)}
            placeholder={pricePlaceholder}
            defaultValue={priceValue(trip.riderPriceCents)}
            className={`${controlClass} tabular-nums`}
          />
        </Field>
        <Field
          label={t("participants.terms.diverSeats")}
          hint={t("participants.terms.diverSeatsHint")}
        >
          <input
            name="diverSeats"
            type="number"
            step={1}
            min={1}
            max={Math.min(trip.capacity, MAX_DIVER_SEATS)}
            defaultValue={trip.diverCapacity ?? ""}
            className={`${controlClass} tabular-nums`}
          />
        </Field>
      </FieldGrid>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel={t("participants.terms.saving")} className={buttonClass()}>
          {t("participants.terms.save")}
        </SubmitButton>
        <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
      </div>
    </form>
  );
}

/**
 * The Details tab's "Snorkelers and riders" row (ADR 20261007-participant-types),
 * or no row at all on a course session, which seats divers only. Built here so
 * the route stays a list of rows; the editor is offered only to who may
 * configure the departure, and the action re-checks.
 */
export function participantTermsRows({
  trip,
  shop,
  locale,
  tripNotice,
  canConfigure,
  shopSlug,
}: {
  trip: Trip;
  shop: { currency: string };
  locale: string;
  tripNotice: FormNotice | undefined;
  canConfigure: boolean;
  shopSlug: string;
}): TripAboutRow[] {
  if (trip.course) return [];
  const t = staffTranslator(locale);
  const currency = toShopCurrency(shop.currency);
  const status = noticeForForm(tripNotice, "participant-terms");
  return [
    {
      id: "participant-terms",
      label: t("participants.terms.heading"),
      value: participantTermsSummary(t, trip, currency, locale),
      editLabel: t("participants.terms.edit"),
      editorOpen: Boolean(status),
      editor: canConfigure ? (
        <ParticipantTermsSection
          action={saveParticipantTermsAction.bind(null, shopSlug, trip.id)}
          status={status}
          trip={trip}
          currency={currency}
          locale={locale}
        />
      ) : undefined,
    },
  ];
}
