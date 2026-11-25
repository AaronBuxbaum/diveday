import { randomUUID } from "node:crypto";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import { getDb } from "@/db/client";
import { readTripCredit, tripCreditBookingOptions } from "@/features/money/trip-credit";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz, formatMoneyCents } from "@/lib/format";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { TripCreditForms, type TripCreditWords } from "./TripCreditForms";
import { TripCreditHistory, tripCreditEntryKey } from "./TripCreditHistory";

export async function TripCreditGroup({
  shopId,
  personId,
  currency,
  timezone,
  locale,
  canGrant,
  removed,
  t,
}: {
  shopId: string;
  personId: string;
  currency: string;
  timezone: string;
  locale: string;
  canGrant: boolean;
  removed: boolean;
  t: StaffTranslator;
}) {
  const db = await getDb();
  const [credit, options] = await Promise.all([
    readTripCredit(db, shopId, personId, currency),
    removed ? Promise.resolve([]) : tripCreditBookingOptions(db, shopId, personId),
  ]);
  if (!canGrant && !credit.entries.length) return null;
  const balances = credit.balances.filter(
    (balance) => balance.balanceCents !== 0 || balance.currency === currency,
  );
  const summary = balances
    .map((balance) =>
      balance.balanceCents === null
        ? t("divers.tripCredit.unavailable")
        : formatMoneyCents(balance.balanceCents, balance.currency, locale),
    )
    .join(" · ");
  const words: TripCreditWords = {
    grant: t("divers.tripCredit.grant"),
    more: t("divers.tripCredit.more"),
    amount: t("divers.tripCredit.amount", { currency: currency.toUpperCase() }),
    reason: t("divers.tripCredit.reason"),
    goodwill: t("divers.tripCredit.goodwill"),
    promotion: t("divers.tripCredit.promotion"),
    busy: t("words.busy.saving"),
    apply: t.raw("divers.tripCredit.apply"),
    eligible: t("divers.tripCredit.eligible"),
    noEligible: t("divers.tripCredit.noEligible"),
    policy: t("divers.tripCredit.policy"),
    granted: t.raw("divers.tripCredit.granted"),
    applied: t.raw("divers.tripCredit.applied"),
    errors: {
      invalid: t("divers.tripCredit.errors.invalid"),
      not_authorized: t("divers.tripCredit.errors.notAuthorized"),
      not_found: t("divers.tripCredit.errors.notFound"),
      unavailable: t("divers.tripCredit.errors.unavailable"),
      insufficient: t("divers.tripCredit.errors.insufficient"),
      changed: t("divers.tripCredit.errors.changed"),
      busy: t("divers.tripCredit.errors.busy"),
    },
  };
  return (
    <DiverFileGroupDisclosure
      id="trip-credit"
      label={t("divers.tripCredit.title")}
      summary={summary}
    >
      {!removed && credit.balanceCents !== null ? (
        <TripCreditForms
          personId={personId}
          currency={currency}
          locale={locale}
          balanceCents={credit.balanceCents}
          canGrant={canGrant}
          grantAttemptId={randomUUID()}
          options={options.map((option) => ({
            ...option,
            attemptId: randomUUID(),
            date: formatDateTimeTz(option.startsAt, locale, timezone),
          }))}
          words={words}
          forgiving={forgivingCopy(t)}
        />
      ) : null}
      <TripCreditHistory
        entries={credit.entries}
        locale={locale}
        timezone={timezone}
        title={t("divers.tripCredit.history")}
        kindLabel={(entry) => t(tripCreditEntryKey(entry))}
      />
    </DiverFileGroupDisclosure>
  );
}
