import { randomUUID } from "node:crypto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { readTripCredit, tripCreditBookingOptions } from "@/features/money/trip-credit";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatMoneyCents } from "@/lib/format";
import { spendTripCreditFromReady } from "../trip-credit-actions";

/** The verified contact can spend promotional value only on this link's own eligible seat. */
export async function OwnTripCredit({
  token,
  locale,
  t,
}: {
  token: string;
  locale: DiverLocale;
  t: DiverTranslator;
}) {
  const db = await getDb();
  const cap = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!cap?.delivered) return null;
  const [shop, options] = await Promise.all([
    getShopById(db, cap.shopId),
    tripCreditBookingOptions(db, cap.shopId, cap.personId, cap.bookingId),
  ]);
  const option = options.find((item) => item.bookingId === cap.bookingId);
  if (!shop || !option) return null;
  const credit = await readTripCredit(db, cap.shopId, cap.personId, shop.currency);
  if (credit.balanceCents === null || credit.balanceCents <= 0 || option.fareCents <= 0)
    return null;
  const balance = formatMoneyCents(credit.balanceCents, shop.currency, locale);
  const fare = formatMoneyCents(option.fareCents, shop.currency, locale);
  if (credit.balanceCents < option.fareCents)
    return (
      <p className="mt-3 text-base text-muted">{t("ready.tripCreditAvailable", { balance })}</p>
    );
  return (
    <form
      action={spendTripCreditFromReady.bind(
        null,
        token,
        randomUUID(),
        shop.currency,
        option.fareCents,
      )}
      className="mt-3"
    >
      <p className="text-base text-muted">{t("ready.tripCreditAvailable", { balance })}</p>
      <SubmitButton
        pendingLabel={t("ready.applyingTripCredit")}
        className={buttonClass({ variant: "secondary" })}
      >
        {t("ready.useTripCredit", { fare })}
      </SubmitButton>
    </form>
  );
}
