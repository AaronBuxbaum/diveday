# 20260731-shop-currency — The shop declares its currency; Stripe's is advisory

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

Every amount DiveDay stores lives in a `*_cents` integer column, and until now the word "cents"
was taken literally in two places at once. The payments path wrote `currency: "usd"` at four
sites — `startBookingCheckout`'s Stripe call and its `booking_checkouts` insert, `createOrder`,
and `setBookingPayment`'s fallback — and every display and form divided or multiplied by a
literal `100`.

Task 60 had already made one dent in this: `startTipCheckout` and the recap page read
`shop_stripe_accounts.default_currency`, the settlement currency Stripe reports for the
connected account. That fixed tips for a European shop and left a worse problem behind. A shop
could be quoted its trips in dollars on the schedule, invoiced in dollars by `createOrder`, and
then asked for a tip in euros on the recap page of the same booking — three surfaces, two
currencies, no single answer to "what does this shop charge in?". It also made the shop's money
a function of an external system's reported state: a Stripe account re-onboarded in a different
country would silently change what every future tip was denominated in.

The literal `100` is the second half of the same problem and the sharper one. It is only correct
for two-decimal currencies. Ten of the twenty-one currencies dive shops actually operate in are
two-decimal; JPY is zero-decimal, and its minor unit *is* the yen. A ¥5,000 trip stored as
`500000` and displayed as `¥5,000.00 ÷ 100 = ¥5,000`… only by accident, and a ¥5,000 trip
stored honestly as `5000` displayed as `¥50`. Either way something is wrong by two orders of
magnitude, on a screen where a diver decides whether to pay.

Ingrid's persona review named both: prices, invoices, and tips must all speak one currency, and
that currency has to be something the shop states rather than something inferred.

## Decision

**`shops.currency` is the single source of truth.** A lowercase ISO 4217 code (Stripe's own
spelling), `NOT NULL DEFAULT 'usd'`, chosen in settings. Every amount the shop displays, and
every *new* row the payments path writes, is denominated in it:

- `startBookingCheckout` — the Stripe Checkout session and the `booking_checkouts` snapshot
- `createOrder` — the Stripe invoice and the `orders` row, and the per-line-item amount ceiling
- `startTipCheckout` — the Stripe Checkout session and the `tips` row (moved off task 60's read
  of the connected account)
- `getRecapPageData` — the tip presets' symbol and label

**`shop_stripe_accounts.default_currency` stays, and stays advisory.** It is what Stripe
*reports*, kept for exactly that. It never overrides what the shop declared. When the two
disagree, `stripeCurrencyMismatch(shopCurrency, account)` returns both codes and the settings
page renders a warning; when they agree, or there is no connected account, or Stripe has not
reported a currency yet, it returns `null` and nothing is said.

**The migration backfills `shops.currency` from the connected account's `default_currency`.**
Task 60's EUR shops were already being charged in euros through the tip path; defaulting every
row to `usd` would have silently re-denominated them on deploy. Backfilling from the account is
the only value that preserves what those shops were actually doing.

**"Cents" means the currency's minor unit, not 1/100.** `src/lib/money.ts` owns the arithmetic:
`currencyFractionDigits` reads the exponent from CLDR via `Intl`, and `minorToMajor` /
`majorToMinor` are the only sanctioned conversions between a stored integer and a number a human
typed or reads. `formatMoneyCents` divides by the currency's own minor unit. Nothing in the
payments path divides at all — a stored integer reaches Stripe unchanged, because Stripe uses
the same convention.

`majorToMinor` rounds, deliberately: `12.1 * 100` is `1209.9999…` in binary floating point, and
a checkout must not be a cent short. Money arithmetic otherwise stays in integer minor units;
`minorToMajor` is for display and for prefilling a form field, never for computing a charge.

**Settled rows keep their own stored currency.** `orders`, `booking_checkouts`, `tips`,
`booking_payments`, and `refunds` each carry a `currency` column, written once from the shop
setting in force at the time. A settled amount is evidence of what a diver was asked for and
what they paid. Changing the shop setting never reinterprets a past amount, and no read path
re-derives a stored row's currency from `shops.currency`. `setShopCurrency` is correspondingly
**not** a conversion: it changes the label on future amounts and leaves every stored integer
alone, so a shop switching `usd → jpy` reinterprets its own price list from $130.00 to ¥13,000
and must re-check it. The settings copy says so out loud.

**`SHOP_CURRENCIES` is a curated list of 21, not all of ISO 4217.** It is the picker's contents.
Every entry is somewhere dive shops actually operate, and every entry has been checked as a
Stripe settlement currency. A list of 180 would be a worse picker, and most of it would be
untested and unreachable — a shop cannot use a currency its connected account cannot settle, so
offering one is offering a broken checkout. Adding an entry is a one-line change gated on
checking Stripe supports it for the country in question.

Amount *bounds* are converted rather than copied, because a bound expressed in minor units means
a different amount of money in each currency. Order line items are capped at 100,000 **major**
units (`majorToMinor(100_000, currency)`), so a JPY shop gets a ¥100,000 ceiling rather than the
hundred-times-looser one a literal `100_000 * 100` gave it. Tips are bounded the same way, with
one extra wrinkle recorded in `src/db/tips.ts`: a flat 1–500 major-unit range is meaningless in
IDR, where 500 rupiah is about three cents, so `tipBoundsCents` scales the range by a coarse,
explicitly-not-an-exchange-rate order of magnitude per currency. Nothing charged, quoted, or
displayed is computed from that table; a bound tolerates being 30% stale, and a price does not.

## Alternatives considered

**Derive the currency from the connected Stripe account (extend task 60 everywhere).** Tempting
because the value already exists and needs no schema change, no picker, and no settings copy. It
was rejected because it makes the shop's own money a read of an external system's state, with
three consequences we do not want. A shop that has not connected Stripe has no currency at all,
so the public schedule would have to guess before any money moves. Re-onboarding a Stripe
account in another country would silently re-denominate every future price with no shop action
and no record. And there is no place to disagree: if Stripe reports something the shop did not
intend, the shop has no way to say so and no warning that it happened. Storing the shop's
declaration and keeping Stripe's as advisory inverts all three — the shop states its intent, and
the external system's disagreement becomes a visible warning instead of a silent override.

**No stored currency; format per request locale.** DiveDay already negotiates a locale from
`Accept-Language`, so a Spanish-speaking diver could be shown `1.234,56 €`. This conflates two
different things and is actively dangerous for money. Locale decides *formatting* — separators,
symbol placement, digit grouping. Currency decides *what is owed*. A Costa Rican shop charging
in USD does not start charging euros because a German diver opened the page, and rendering
`130` as `130,00 €` to that diver would be a false statement about the price, not a translation
of it. The two stay orthogonal: `formatMoneyCents(cents, shop.currency, requestLocale)` — the
shop supplies the currency, the request supplies the formatting.

**A per-currency hand-kept table of fraction digits.** Rejected in favour of reading CLDR through
`Intl.NumberFormat().resolvedOptions()`, so adding a currency to `SHOP_CURRENCIES` needs no
second edit and can't drift. `Intl` reports 2 for a code it doesn't know, which is also the right
guess.

**Store amounts as decimals/`numeric`.** Would remove the minor-unit question entirely, at the
cost of a migration across every money column in the schema, a float-adjacent type in the
booking transaction, and a mismatch with Stripe's API, which is integer-minor-unit throughout.
Integers stay.

## Consequences

- A shop that picks a currency its Stripe account cannot settle gets a **refused checkout**, not
  a silent conversion. Stripe rejects a session or invoice in an unsupported currency for the
  connected account, and `startBookingCheckout` / `createOrder` / `startTipCheckout` all fail
  closed on a Stripe error — the diver sees the pay flow decline, the seat is unaffected, and no
  money moves. `stripeCurrencyMismatch` exists so this is caught in settings first, as a warning
  the shop can act on, rather than at the moment a diver tries to pay. The warning is advisory
  and does not block saving the setting: a shop mid-migration between Stripe accounts has a
  legitimate reason to be briefly mismatched.
- Changing the setting re-labels every future amount and re-interprets the shop's own stored
  price list without converting it. There is no FX in DiveDay, deliberately — a rate we did not
  fetch and cannot vouch for has no business rewriting a shop's prices.
- Every payments caller now reads one extra row (`getShopCurrency`) before touching Stripe. This
  is a primary-key lookup on a row the request has almost always already loaded; the cost is
  accepted in exchange for not threading a currency parameter through every call site, where it
  would eventually be passed wrong.
- Multi-currency *within* one shop is out of scope and stays out. A shop has one currency at a
  time. Settled rows carry their own, so history across a change reads correctly, but there is
  no way to price one trip in USD and another in EUR — and no demand for it.

## References

- `src/lib/money.ts`, `src/lib/format.ts` — the arithmetic and the display
- `src/db/stripe-accounts.ts` — `getShopCurrency`, `stripeCurrencyMismatch`
- `src/db/shops.ts` — `setShopCurrency` and what it deliberately does not do
- ADR 20260731-domain-layer-copy-leaks — why `src/lib`/`src/db` return codes, including currency
  codes, and never the words around them
