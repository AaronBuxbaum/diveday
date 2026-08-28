/**
 * Shop-wide promo codes: what a code may say, what it may be spent on, and
 * whether it is live right now. Framework-free (docs ADR
 * 20260729-shop-promo-codes); the Stripe coupon/promotion-code calls live in
 * src/lib/payments/promotions.ts and the shop-scoped lookup in
 * src/db/shop-promos.ts.
 *
 * This is the general model that ADR 20260727-last-minute-fill-promos
 * deliberately stopped short of. A trip-scoped last-minute code is still its
 * own narrow producer — it validates against `(shop, trip, code)` and expires
 * at that departure — and nothing here replaces it.
 */

/** Mirrors the `shop_promo_codes_discount_range` check constraint. */
export const PROMO_DISCOUNT_MIN = 1;
export const PROMO_DISCOUNT_MAX = 100;

/** Bounds on the code text itself: long enough to be unguessable, short enough to say aloud. */
export const PROMO_CODE_MIN_LENGTH = 3;
export const PROMO_CODE_MAX_LENGTH = 40;

export function isValidPromoDiscountPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= PROMO_DISCOUNT_MIN &&
    value <= PROMO_DISCOUNT_MAX
  );
}

/**
 * A diver-typed code to its canonical form, or null when it could never be one.
 * Upper-cased because Stripe promotion codes are case-sensitive and divers
 * reliably fat-finger case; inner whitespace dropped because "REEF 20" copied
 * out of an email is the same code as "REEF20". Anything outside `A–Z 0–9 - _`
 * is rejected rather than stripped — silently mangling a typo into a *different
 * shop's* real code would be worse than not matching.
 */
export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\s+/g, "").toUpperCase();
  if (code.length < PROMO_CODE_MIN_LENGTH || code.length > PROMO_CODE_MAX_LENGTH) return null;
  return /^[A-Z0-9_-]+$/.test(code) ? code : null;
}

/** What a booking is buying — the axis a code's scope is checked against. */
export type PromoBookingKind = "trip" | "course";

/** Mirrors the `shop_promo_scope` pg enum. */
export type PromoScope = "all" | "trips" | "courses";

/** True when a code issued at this scope may be spent on this kind of booking. */
export function promoScopeCovers(scope: PromoScope, kind: PromoBookingKind): boolean {
  if (scope === "all") return true;
  return scope === "trips" ? kind === "trip" : kind === "course";
}

export type PromoWindow = {
  startsAt: Date | null;
  expiresAt: Date | null;
};

export type PromoWindowState = "live" | "not_started" | "expired";

/**
 * Where `now` sits in a code's window. A null bound is unbounded on that side —
 * no start date means live from creation, no end date means the shop set none.
 * Expiry is exclusive of the instant itself: a code expiring at noon is dead at
 * noon, matching how Stripe treats `expires_at`.
 */
export function promoWindowState(window: PromoWindow, now: Date): PromoWindowState {
  if (window.startsAt && now < window.startsAt) return "not_started";
  if (window.expiresAt && now >= window.expiresAt) return "expired";
  return "live";
}

/** A code's usage against its own cap — the second half of "is it over?". */
export type PromoUsage = {
  timesRedeemed: number;
  maxRedemptions: number | null;
};

/**
 * Whether a code has been spent to its cap. An uncapped code is never
 * exhausted, which is why the null check comes first rather than being folded
 * into the comparison.
 *
 * Stripe owns the *enforcement* of the cap — {@link isPromoRedeemable}
 * deliberately does not consult it, because re-deriving it locally would be a
 * second, lagging authority on whether a checkout may proceed. What it is
 * honest for is the shelf a staffer finds the code on: a code with nothing
 * left to give is over, and filing it under Live would be the list lying about
 * its own shape.
 */
export function isPromoExhausted(usage: PromoUsage): boolean {
  if (usage.maxRedemptions === null) return false;
  return usage.timesRedeemed >= usage.maxRedemptions;
}

/** Which shelf of the staff codes ledger a code sits on. */
export type PromoLedgerGroup = "live" | "scheduled" | "ended";

/**
 * The three shelves the codes ledger groups into (ADR
 * 20260827-the-shops-shelves, decision 1): the codes working now, the ones
 * that have not started, and the ones that are over.
 *
 * Derived from the *window* and the cap, never from `status`, and that split
 * is the point. A code's window is a fact every row in a run shares, so it
 * belongs to the group header; `pending`, `failed` and switched-off are
 * exceptions belonging to one row, so they stay on that row's badge. A code
 * switched off inside a live window is therefore filed under Live and says
 * "Switched off" beside its own name — both facts, each said once. Folding
 * status into the grouping would file it under a shelf that describes neither.
 *
 * Precedence is {@link promoWindowState}'s own, so this and the booking path
 * can never disagree about which end of the window a code is at.
 */
export function promoLedgerGroup(promo: PromoWindow & PromoUsage, now: Date): PromoLedgerGroup {
  const window = promoWindowState(promo, now);
  if (window === "not_started") return "scheduled";
  if (window === "expired") return "ended";
  return isPromoExhausted(promo) ? "ended" : "live";
}

export type PromoRedeemability = {
  status: string;
  scope: PromoScope;
  startsAt: Date | null;
  expiresAt: Date | null;
};

/**
 * The single predicate the booking path asks: may this code be applied to this
 * purchase, right now? Deliberately boolean — the diver-facing behavior for
 * "wrong code", "not started", "expired", and "wrong kind of booking" is
 * identical (the code simply doesn't apply), so distinguishing them here would
 * only ever leak which codes a shop actually has.
 *
 * Note what this does *not* check: the redemption cap. Stripe owns that count
 * and enforces it at checkout; re-deriving it locally would be a second,
 * lagging source of truth for the same fact.
 */
export function isPromoRedeemable(
  promo: PromoRedeemability,
  kind: PromoBookingKind,
  now: Date,
): boolean {
  if (promo.status !== "active") return false;
  if (!promoScopeCovers(promo.scope, kind)) return false;
  return promoWindowState(promo, now) === "live";
}

/**
 * What a percent-off code leaves to pay, in minor units. Mirrors Stripe's own
 * arithmetic (it rounds the *discount*, then subtracts) so the figure quoted on
 * the booking form matches the figure charged. Stripe remains the authority —
 * this is what to show a diver, not what to bill them.
 */
export function discountedAmountCents(amountCents: number, discountPercent: number): number {
  const discount = Math.round((amountCents * discountPercent) / 100);
  return Math.max(0, amountCents - discount);
}
