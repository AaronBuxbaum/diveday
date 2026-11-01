import { deskPaymentSentence } from "@/i18n/desk-payment-labels";
import type { DiverTranslator } from "@/i18n/messages";
import { partyMoneyTerms } from "@/lib/deposits";
import type { DeskPayment } from "@/lib/desk-payment";
import { formatMoneyCents } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import type { ParticipantType } from "@/lib/participant-types";

/** What the Pay step needs from the booking's receipt. */
type Receipt = {
  amountCents: number | null;
  currency: string;
  isDeposit: boolean;
  balanceDueCents: number;
} | null;

/**
 * The Pay step's two lines, composed for the readiness thread.
 *
 * `paidLine` is what the step says once it has settled: the figure, which is
 * the one thing the step's own word ("Paid") cannot carry. The receipt's
 * currency, not the shop's — a shop that switches currency next season must
 * not restate last season's charge (ADR 20260731-shop-currency).
 *
 * "N package dives left" (owner decision 2026-10-09) rides on it: the one
 * number a diver who bought a package asks, said where the money already is.
 * The caller counts it as `countSpendableDives` does, so a lapsed or spent dive
 * is never offered, and a diver who holds none hears nothing about packages.
 *
 * **A package dive is one tank** (H-20261014-package-dive-is-a, fourth UX review item 9). When this
 * booking spent some, the line says how many of what the diver held, and that
 * it is one per tank, so a two-tank boat using two is never a surprise.
 */
export function payStepLines(
  t: DiverTranslator,
  money: (cents: number, currency: string) => string,
  receipt: Receipt,
  packageDives: { left: number; usedHere: number },
  /** How the shop takes the balance at the desk, said after it (dive-domain review N4 of layer r5-3). */
  deskPayment: DeskPayment | null = null,
): { paidLine: string; depositBalanceLine: string | null } {
  const paid =
    receipt && receipt.amountCents !== null
      ? money(receipt.amountCents, receipt.currency)
      : t("ready.checklistDetail.paymentDone");
  return {
    paidLine:
      packageDives.usedHere > 0
        ? t("ready.packageDivesUsed", {
            line: paid,
            used: packageDives.usedHere,
            left: packageDives.left,
          })
        : packageDives.left > 0
          ? t("ready.packageDivesLeft", { line: paid, count: packageDives.left })
          : paid,
    depositBalanceLine:
      receipt?.isDeposit && receipt.balanceDueCents > 0
        ? [
            t("booking.paymentDepositBalance", {
              balance: money(receipt.balanceDueCents, receipt.currency),
            }),
            deskPaymentSentence(t, deskPayment),
          ]
            .filter(Boolean)
            .join(" ")
        : null,
  };
}

/**
 * **What is owed at the shop, said once** (fourth UX review, item 5). A
 * pay-at-shop booking named no amount on the page the diver keeps, while
 * every unclaimed party seat stays with the lead "exactly as booked". The
 * same sentence as the lead's confirmation: "3 seats: $285.00, due at the
 * shop". `types` is the lead's own seat first, then each seat still theirs; a
 * claimed seat is its claimant's, on their own page. Null when nothing is
 * owed at the shop.
 */
export function atShopMoneyLine(
  t: DiverTranslator,
  locale: string,
  currency: string,
  data: {
    owesAtShop: boolean;
    participantType: ParticipantType;
    shop: { deskPayment: DeskPayment | null };
  },
  trip:
    | (Parameters<typeof partyMoneyTerms>[0] & { course: Parameters<typeof partyMoneyTerms>[1] })
    | null
    | undefined,
  partySeats: readonly { claimed: boolean; participantType: ParticipantType }[],
): string | null {
  if (!data.owesAtShop || !trip) return null;
  const types = [
    data.participantType,
    ...partySeats.filter((seat) => !seat.claimed).map((seat) => seat.participantType),
  ];
  const terms = partyMoneyTerms(trip, trip.course, types, false);
  if (terms?.due !== "at_shop") return null;
  const amount = formatMoneyCents(terms.amountCents, toShopCurrency(currency), locale);
  const line =
    terms.seats > 1
      ? t("notifications.bookingConfirmation.moneyPartyAtShop", { seats: terms.seats, amount })
      : t("notifications.bookingConfirmation.moneyAtShop", { amount });
  // The figure drops when a seat is claimed; say why, so the lead does not
  // read it as a discount (dive-domain review N5 of layer r4-1).
  const claimed = partySeats.filter((seat) => seat.claimed).length;
  // Then how the desk takes it, when the shop has said (fifth-loop ideas, item 21).
  return [
    line,
    claimed > 0 ? t("ready.partyClaimedSeatsPayOwn", { count: claimed }) : null,
    deskPaymentSentence(t, data.shop.deskPayment),
  ]
    .filter(Boolean)
    .join(" ");
}
