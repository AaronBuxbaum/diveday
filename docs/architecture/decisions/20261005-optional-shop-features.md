# 20261005-optional-shop-features — Let a shop switch off reviews, date requests, the last-minute list and tips

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Aaron asked for the features some shops will not want to sit behind a setting (2026-10-05), after
the crew schedule became one (ADR 20261005-crew-schedule-is-a-setting). An audit of every surface
found that nothing else a shop might skip had an off switch. Courses, Gear, the badge wall and
nitrox already appear only once a shop has some. Four features showed up for every shop whether it
used them or not:

- **Diver reviews.** The recap's main ask is a star rating, and published ratings show on the
  shopfront, trip and course pages and in their structured data. A shop that sends divers to Google
  or TripAdvisor instead collects ratings it never wanted.
- **Date requests.** The shopfront's "ask for a day" form asks the shop to create a departure. A
  shop that runs a fixed schedule has no answer to that.
- **The last-minute list.** The shopfront offers a sign-up for discounted seats. A shop that never
  discounts collects addresses for a promise it will not keep.
- **Tips.** The recap offers a tip by card. Tipping is the custom in some waters and an awkward ask
  in others.

One more surface was noise without a setting. The booking form showed a discount-code box on every
paid booking, even for a shop that had never made a code. That sends a diver to look for a
discount that does not exist.

## Decision

- Four booleans on `shops`, all **default true**: `reviews_enabled`, `date_requests_enabled`,
  `last_minute_list_enabled` and `tips_enabled`. A new shop sees what every shop saw before. Unlike
  the crew schedule, none of these adds empty rows or standing warnings, so leaving them on costs a
  new shop nothing it has to learn to ignore.
- `src/lib/shop-features.ts` names the features. Each switch is a Settings row with the same
  shape as the crew schedule's: the row reads On or Off, and opening it shows one checkbox and what
  it covers. All four post to one action, `saveShopFeatureAction`. Each row sits in the group its
  feature belongs to (reviews under Messages, beside the review link; date requests and the
  last-minute list under Website; tips under Money), so a shop finds a switch where it already
  looks for the setting it relates to.
- The check lives at the reader, so no surface can forget it:
  - **Reviews off.** `submitTripReview` refuses, the recap shows no rating card, the public reviews
    page 404s, and no aggregate or review reaches the shopfront, trip or course pages or their
    structured data. Today stops asking staff to read waiting reviews
    (`readReviewsAwaitingModeration`). The staff Reviews tab stays, because the recap's private
    note to the shop lands there whatever this says. The shop's own `review_url` is untouched.
  - **Date requests off.** The shopfront form is gone and `submitInquiryAction` refuses a request
    that names no course. A course page's own inquiry is not a date request. It is how a course
    converts, so it stays, and so does the Requests tab that reads both.
  - **Last-minute list off.** The shopfront sign-up and the full trip's link to it are gone, and
    `joinLastMinuteListAction` refuses. `listLastMinuteList` and `listActiveLastMinuteWindows`
    return nobody, so the trip page's deal sender, the send itself and Today's "fill these seats"
    row all find no one to reach.
  - **Tips off.** `canTip` is false on the recap, and `startTipCheckout` refuses with `tips_off`.
- **Turning a feature off deletes nothing.** Reviews, requests, list entries and tips are where
  they were when it comes back on.
- **The discount-code box has no switch.** It shows only when `tripMayTakeACode` finds a live
  shop-wide code or a last-minute deal sent for that departure. It errs toward showing: scope and a
  future start date are not checked. Whether a typed code applies is still decided by
  `getRedeemableShopPromo` and `getActiveTripPromoByCode`.
  The box therefore tells a visitor whether the shop has a live code, or sent a deal for this
  departure, but never which code. A security review (2026-10-05) accepted that as a business
  signal rather than an exposure: the codes stay unguessable, and a refused code still reads the
  same whatever the reason.

## Alternatives considered

- **One "Features" group in Settings listing every switch.** It is easier to scan as a list, but a
  shop looking for tips looks under Money, not under a heading named for how the product is built.
  The crew schedule already lives under Team for the same reason.
- **Default off, like the crew schedule.** Rejected. These features are how a shop earns ratings,
  repeat bookings and tips, and none of them is noise for a shop that leaves them alone. The crew
  schedule defaults off because, left on, it fills a new shop's screens with empty rows and
  warnings.
- **Switch off by presence, like the gear register.** Not possible. Each of these features is
  something a diver starts, so the shop has nothing to add before it would show.
- **Also switching off buddy teams, the waitlist and the close-out.** Rejected. Buddy teams feed the
  split-team safety alert. The waitlist and the close-out appear only when there is something to
  show.

## Consequences

A shop can turn off each of the four in one row. Any new surface for one of them must read its
column or go through the reader that already does. If it doesn't, it will offer the feature to a
shop that switched it off. That is noisy rather than unsafe, except for a tip or a review, where
the server-side refusals are the backstop.
