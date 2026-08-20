# FU-20260820-one-page-after-booking — Land a booked diver on `/ready` and delete the confirmation branch

- **Status:** Open
- **Raised:** 2026-08-20 — the nine-item UX pass on `ux-refinements-nine`; the eighth item, scoped and decided but not built
- **Kind:** improvement
- **Effort:** L
- **Touches:** `src/app/s/[shopSlug]/trips/[id]/_components/BookingConfirmation.tsx`, `src/app/s/[shopSlug]/trips/[id]/actions.ts`, `src/app/s/[shopSlug]/trips/[id]/page.tsx`, `src/app/ready/[token]/page.tsx`, `src/app/ready/[token]/actions.ts`, `src/db/booking-capabilities.ts`

## What I noticed

`/ready/[token]` and the post-booking confirmation are two pages doing most of
the same job, and the confirmation is the weaker one.

The confirmation is not a route. It is a `?booking=<confirm token>` branch of the
public trip page (`page.tsx`, `confirmed ? <BookingConfirmation/> : …`), and its
token is **never emailed** — it exists only in that URL and in Stripe's
`success_url`. Close the tab and the only durable link to the booking is
`/ready`, which every confirmation email and every reminder already carries.

Both mount `RentalFitForm`. Both mount `PartyClaimPanel`, `EarnedMoment`,
`PackingSection` and `DiveBriefingsSection` — three of which `/ready` imports
*across the route boundary* from the trip page's `_components/`, so a `_components`
folder is already being used as a shared library. And the same three intents have
two implementations each:

| Intent | Confirmation | `/ready` |
| --- | --- | --- |
| Sign the waiver | `signWaiverFromConfirmation` | `signWaiverFromReady` |
| Pay | `payForBooking` | `payFromReady` |
| Save rental fit | `saveRentalFitRequest` | `saveFitFromReady` |

What only the confirmation has: the payment **receipt** (`PaymentSection` —
paid / deposit + balance due / pending / payable, via `resolvePaymentPanel`),
`TripTerms cancellationOnly`, and the "two emails are on their way" line. What
only `/ready` has: the full readiness checklist rather than one `nextStep` line,
the emergency-contact capture, reschedule, self-cancel with a refund preview, and
the shop's address and map.

**The decision is already made** (product owner, 2026-08-20): *one page — redirect
to `/ready`*. Not "keep both with a strict split", and not "share a spine". Do not
re-litigate it.

## Why it isn't already done

It was the ninth of nine items in one pass and the largest: it moves Stripe's
return URLs, deletes a page, and collapses one of the two booking-capability
purposes. The eight items before it already had a `dive-domain-expert` pass catch
a reversed Chosen decision and a `security-reviewer` pass catch a real safety
hole, both in changes a fraction of this size. Starting it fresh is worth more
than finishing it tired.

One worry raised at the time and since **checked and dismissed**, recorded so
nobody spends the hour again: this does *not* cost the trip page its SEO.
`tripPageJsonLd` and `robots` are gated on `isEmbed`, never on `confirmed`
(`page.tsx:389`), so the indexed, structured-data-carrying trip page is exactly
what an unbooked visitor already sees and is untouched. Only the booked branch
goes.

The genuinely open question is **embed mode**. `?embed=1` is the widget a shop
frames on its own site (ADR 20260726-schedule-embed). A redirect to `/ready`
either breaks the diver out of the frame with `target="_top"` — which is what the
existing `booking.trackReadiness` link already does from inside the embed — or the
embed keeps a small inline confirmation of its own. Decide it deliberately; it is
the one place "one page" may honestly need to be two.

## Proposed change

1. After `bookSpot` succeeds, mint the readiness capability (it already does, for
   the confirmation email) and redirect to `/ready/<token>?booked=1` instead of
   `${base}?booking=${confirmToken}`.
2. Point `startCheckoutUrl`'s `returnBase` at the same readiness URL, so Stripe's
   `success_url` / `cancel_url` land there too. Keep the `&pay=cancelled` shape
   `/ready` already reads.
3. Move onto `/ready`: the payment receipt (`resolvePaymentPanel` and
   `PaymentSection`), `TripTerms cancellationOnly`, add-to-calendar and share
   (`TripActions`, and the `/calendar` ICS route it links), and the
   `booking.emailsOnTheWay` line. Show the earned moment on `?booked=1` only —
   `/ready` currently shows one when the diver is *fully ready*, which is a
   different moment and both should not fire at once.
4. Delete `BookingConfirmation.tsx`, its branch in `page.tsx`, and
   `signWaiverFromConfirmation` / `payForBooking` / `saveRentalFitRequest` in
   favour of the `/ready` equivalents.
5. Then ask whether the `"confirm"` capability purpose has any caller left. If
   not, remove it; if the embed keeps an inline confirmation, it does.

Do **not** move the forecast card or the conditions-changed banner in step 3
without deciding they belong: they are about the *departure*, and `/ready` has
deliberately never carried them.

## Prompt

```text
Read docs/architecture/decisions/20260804-seat-claim-links.md and
20260726-schedule-embed.md first, then src/app/s/[shopSlug]/trips/[id]/page.tsx
(the `confirmed ?` branch) beside src/app/ready/[token]/page.tsx.

Land a booked diver on /ready and delete the confirmation. The post-booking
confirmation is a `?booking=<confirm token>` branch of the public trip page whose
token is never emailed, so closing the tab leaves /ready as the only durable
link — while both pages mount the same RentalFitForm, PartyClaimPanel and
EarnedMoment, and the same three intents have two server actions each
(signWaiverFromConfirmation/payForBooking/saveRentalFitRequest vs
signWaiverFromReady/payFromReady/saveFitFromReady).

The shape is decided — ONE page, redirect to /ready. Do not re-open it.

1. `bookSpot` (trips/[id]/actions.ts, the redirect near the end) sends the diver
   to /ready/<readiness token>?booked=1. It already mints that capability for the
   confirmation email; reuse it.
2. `startCheckoutUrl`'s `returnBase` in the same file points at that URL too, so
   Stripe's success_url/cancel_url land there. Keep the `&pay=cancelled` shape
   /ready already reads.
3. Move onto /ready: the payment receipt (`resolvePaymentPanel` + PaymentSection),
   TripTerms cancellationOnly, add-to-calendar/share (TripActions + the /calendar
   ICS route), and booking.emailsOnTheWay. Fire the earned moment on `?booked=1`
   only — /ready already shows one when a diver is fully ready and both must not
   fire at once. Do NOT move the forecast or conditions-changed banner; those are
   about the departure and /ready has never carried them.
4. Delete BookingConfirmation.tsx, its branch in page.tsx, and the three
   duplicate actions.
5. Then check whether the "confirm" capability purpose has a caller left; remove
   it if not.

DECIDE EMBED MODE DELIBERATELY and say what you chose in the PR: `?embed=1` is a
widget framed on the shop's own site, so a redirect either breaks out with
target="_top" (what booking.trackReadiness already does from inside the embed) or
the embed keeps a small inline confirmation. This is the one place "one page" may
honestly need to be two.

Already checked, don't redo it: this costs the trip page no SEO. tripPageJsonLd
and robots are gated on isEmbed, never on `confirmed` (page.tsx:389), so the
indexed page is what an unbooked visitor already sees and is untouched.

Done when: pnpm check is green, `pnpm e2e e2e/booking.spec.ts e2e/nitrox.spec.ts
e2e/trip-admission.spec.ts --reporter=line` passes (booking.spec.ts asserts the
confirm-token tamper cases and will need rewriting against the new destination),
and you have looked at the booked state in light and dark, embedded and not.
Expect visual diffs on the booking-confirmed and readiness captures and say why
each moved. Delete docs/product/follow-ups/FU-20260820-one-page-after-booking.md
as part of the change.
```
