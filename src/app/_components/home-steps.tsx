import type { ReactNode } from "react";
import { ArrivalDeskFallback } from "@/components/MarketingArrivalDeskFallback";
import {
  CheckoutFallback,
  RegisterFallback,
  SeatPickFallback,
} from "@/components/MarketingBookingWalkScreens";
import { OrdersLedgerFallback, WaiverSigningFallback } from "@/components/MarketingFeatureScreens";
import {
  CaptainRollCallFallback,
  FrontDeskReadinessFallback,
  RecapPageFallback,
} from "@/components/MarketingScreenFallbacks";
import { StorefrontFallback } from "@/components/MarketingStorefrontFallback";
import { CardCheckFallback } from "@/components/MarketingWalkScreens";
import { WalkSwap } from "@/components/WalkTyped";
import type { DiverMessageKey } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { FeaturePageSlug } from "@/lib/feature-pages";

/**
 * **Priya's booking, one slide at a time, from the shop's website to the boat and home again.**
 * Every slide is its own step: its own heading and notes about the one screen beside it, and (where
 * a feature page tells the rest) a link to that page. The slide's drawing is a pair of the same
 * screen, `before` a tap and `screen` after it (the tapped control marked `data-tap-target`), and the
 * walk (`HomeWalkthrough`) shows the first, lands a fingertip on the control, and swaps to the
 * second. Every tap is Priya's or the crew's on her row, never another diver's.
 *
 * A reader without the player sees the `listed` slides only, one drawing each, in the order a diver
 * meets the shop and the order an owner's doubts arrive in: will they book, does the paperwork come
 * back, who catches the diver who isn't cleared, does the roll call on the boat hold, and what does
 * the diver take home. The rest are the walk's: they are in the page, hidden until it runs
 * (`WALK_CLASSES`), so the server HTML stays the one place the story is written.
 *
 * Every slide carries its own words under `marketing.home.steps.<id>`: what is going on and why it is
 * good for the shop, in a sentence or two, never a list of what the screen holds.
 *
 * `id` is the bundle namespace under `marketing.home.steps` and the caption's under
 * `marketing.home.walk.captions`, never a rendered string. The order of this list is the order of the
 * story: Priya's day is a slide per entry, about ten seconds each.
 */
export type StepId =
  | "browse"
  | "pay"
  | "money"
  | "onboard"
  | "unsigned"
  | "sign"
  | "check"
  | "card"
  | "desk"
  | "aboard"
  | "recap"
  | "review";

export const STEPS: readonly {
  id: StepId;
  /** Seen by a reader without the player. */
  listed?: true;
  /** How long the screen plays before the tap (ms): her typing, her pointer, a page giving way to the next. */
  lead?: number;
  /** How long the tap lasts (ms); none where the drawing's own pointer has just pressed the last control. */
  tapMs?: number;
  /** How long the finished screen stays (ms); a screen that only leads into the next needs little. */
  hold?: number;
  /** The feature page the slide ends in; none where there is no page to send a reader to. */
  feature?: FeaturePageSlug;
  /** The one line of why, under the slide's title. */
  note: DiverMessageKey;
  /** The drawing's name for a screen reader. */
  label: DiverMessageKey;
  /** The screen a moment before the tap, with the tapped control marked `data-tap-target`. */
  before: (locale: DiverLocale) => ReactNode;
  /** The screen the tap leads to, and what a reader without the player sees. */
  screen: (locale: DiverLocale) => ReactNode;
}[] = [
  {
    // Looking around, picking a boat and pressing Pay are one slide: her pointer clicks a trip in
    // the week's list, the seat page opens, and she taps Book and pay, which loads the checkout
    // the next slide fills in (Aaron, 2026-11-17 and 2026-11-18).
    id: "browse",
    lead: 4400,
    hold: 3000,
    feature: "online-booking",
    note: "marketing.home.steps.browse.note",
    label: "marketing.home.steps.browse.mockupLabel",
    before: (locale) => (
      <WalkSwap
        at={1750}
        from={<StorefrontFallback locale={locale} tapBoat />}
        to={<SeatPickFallback locale={locale} tapPay />}
      />
    ),
    screen: (locale) => <CheckoutFallback locale={locale} state="blank" />,
  },
  {
    id: "pay",
    lead: 2900,
    listed: true,
    feature: "payments",
    note: "marketing.home.steps.pay.note",
    label: "marketing.home.steps.pay.mockupLabel",
    before: (locale) => <CheckoutFallback locale={locale} state="entering" />,
    screen: (locale) => <CheckoutFallback locale={locale} state="paid" />,
  },
  {
    id: "money",
    note: "marketing.home.steps.money.note",
    label: "marketing.home.steps.money.mockupLabel",
    before: (locale) => <OrdersLedgerFallback locale={locale} state="waiting" />,
    screen: (locale) => <OrdersLedgerFallback locale={locale} state="paid" />,
  },
  {
    id: "onboard",
    lead: 4200,
    note: "marketing.home.steps.onboard.note",
    label: "marketing.home.steps.onboard.mockupLabel",
    before: (locale) => <RegisterFallback locale={locale} state="filling" />,
    screen: (locale) => <RegisterFallback locale={locale} state="done" />,
  },
  {
    id: "unsigned",
    feature: "waivers",
    note: "marketing.home.steps.unsigned.note",
    label: "marketing.home.steps.unsigned.mockupLabel",
    before: (locale) => <FrontDeskReadinessFallback locale={locale} state="unsigned" />,
    screen: (locale) => <FrontDeskReadinessFallback locale={locale} state="nudged" />,
  },
  {
    id: "sign",
    lead: 4150,
    tapMs: 0,
    listed: true,
    feature: "waivers",
    note: "marketing.home.steps.sign.note",
    label: "marketing.home.steps.sign.mockupLabel",
    before: (locale) => <WaiverSigningFallback locale={locale} state="filling" />,
    screen: (locale) => <WaiverSigningFallback locale={locale} state="signed" />,
  },
  {
    // The readiness list a reader without the player sees: the boarding check's own rows.
    id: "check",
    listed: true,
    feature: "certifications",
    note: "marketing.home.steps.check.note",
    label: "marketing.home.steps.check.readyLabel",
    before: (locale) => <FrontDeskReadinessFallback locale={locale} state="nudged" />,
    screen: (locale) => <FrontDeskReadinessFallback locale={locale} state="ready" />,
  },
  {
    id: "card",
    feature: "certifications",
    note: "marketing.home.steps.card.note",
    label: "marketing.home.steps.card.mockupLabel",
    before: (locale) => <CardCheckFallback locale={locale} state="pending" />,
    screen: (locale) => <CardCheckFallback locale={locale} state="certified" />,
  },
  {
    id: "desk",
    feature: "check-in",
    note: "marketing.home.steps.desk.note",
    label: "marketing.home.steps.desk.mockupLabel",
    before: (locale) => <ArrivalDeskFallback locale={locale} state="ready" held="card" />,
    screen: (locale) => <ArrivalDeskFallback locale={locale} state="checkedIn" held="card" />,
  },
  {
    // The hero draws the dock's roll-call phone, so this slide draws the same screen a dive later,
    // after the desk (B14, 2026-10-25); the notes keep H-20260802-may-public-pages-say's no-signal
    // claim, and the paper packet is for the owner who still carries it (issue #4322).
    id: "aboard",
    listed: true,
    feature: "boat-manifest",
    note: "marketing.home.steps.aboard.note",
    label: "marketing.home.steps.aboard.boatLabel",
    before: (locale) => <CaptainRollCallFallback locale={locale} state="afterDivePending" />,
    screen: (locale) => <CaptainRollCallFallback locale={locale} state="afterDive" />,
  },
  {
    // The report goes out by itself a few hours after the boat is due back. She scrolls it for the whole slide (`lead`), so the page
    // reaches its end as the slide does. Its drawing carries the label `RecapPageFallback` names.
    id: "recap",
    lead: 9000,
    tapMs: 0,
    hold: 600,
    listed: true,
    feature: "recap",
    note: "marketing.home.steps.recap.note",
    label: "marketing.home.steps.recap.mockupLabel",
    before: (locale) => <RecapPageFallback locale={locale} view="report" scroll />,
    screen: (locale) => <RecapPageFallback locale={locale} view="report" scroll />,
  },
  {
    id: "review",
    lead: 4500,
    feature: "reviews",
    note: "marketing.home.steps.review.note",
    label: "marketing.home.steps.review.mockupLabel",
    before: (locale) => <RecapPageFallback locale={locale} view="review" state="writing" />,
    screen: (locale) => <RecapPageFallback locale={locale} view="review" state="posted" />,
  },
];

/**
 * What the list does once the player has marked it (`data-walk`): one slide at a time. Without the
 * mark (no script, or before it runs) the `listed` slides show and the rest are hidden, which is the
 * list this page always was.
 *
 * A slide draws both screens in one grid cell (so it never changes height) and the player's
 * `data-walk-phase` says which shows: `before`, then `tap` (the same screen, a finger landing on its
 * `data-tap-target`), then `after` (its `data-walk-pop` marks settle in). With no phase (no script,
 * reduced motion, a paused walk) the finished screen shows.
 */
export const WALK_CLASSES =
  "[&:not([data-walk])>li:not([data-walk-listed])]:hidden [&[data-walk]>li:not([data-walk-current])]:hidden [&:not([data-walk-phase=before]):not([data-walk-phase=tap])_[data-walk-before]]:invisible [&[data-walk-phase=before]_[data-walk-after]]:invisible [&[data-walk-phase=tap]_[data-walk-after]]:invisible";
