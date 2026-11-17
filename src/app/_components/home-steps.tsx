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
  /** She types into this slide's screen first, so the beat runs longer and taps later. */
  typed?: true;
  /** The feature page the slide ends in; none where there is no page to send a reader to. */
  feature?: FeaturePageSlug;
  notes: readonly [DiverMessageKey, DiverMessageKey, ...DiverMessageKey[]];
  /** The drawing's name for a screen reader. */
  label: DiverMessageKey;
  /** The screen a moment before the tap, with the tapped control marked `data-tap-target`. */
  before: (locale: DiverLocale) => ReactNode;
  /** The screen the tap leads to, and what a reader without the player sees. */
  screen: (locale: DiverLocale) => ReactNode;
}[] = [
  {
    // Looking around and picking a boat are one slide: she taps a trip in the week's list and the
    // seat card opens (Aaron, 2026-11-17).
    id: "browse",
    feature: "online-booking",
    notes: ["marketing.home.steps.browse.note1", "marketing.home.steps.browse.note2"],
    label: "marketing.home.steps.browse.mockupLabel",
    before: (locale) => <StorefrontFallback locale={locale} tapBoat />,
    screen: (locale) => <SeatPickFallback locale={locale} />,
  },
  {
    id: "pay",
    listed: true,
    typed: true,
    feature: "payments",
    notes: ["marketing.home.steps.pay.note1", "marketing.home.steps.pay.note2"],
    label: "marketing.home.steps.pay.mockupLabel",
    before: (locale) => <CheckoutFallback locale={locale} state="entering" />,
    screen: (locale) => <CheckoutFallback locale={locale} state="paid" />,
  },
  {
    id: "money",
    notes: ["marketing.home.steps.money.note1", "marketing.home.steps.money.note2"],
    label: "marketing.home.steps.money.mockupLabel",
    before: (locale) => <OrdersLedgerFallback locale={locale} state="waiting" />,
    screen: (locale) => <OrdersLedgerFallback locale={locale} state="paid" />,
  },
  {
    id: "onboard",
    typed: true,
    notes: ["marketing.home.steps.onboard.note1", "marketing.home.steps.onboard.note2"],
    label: "marketing.home.steps.onboard.mockupLabel",
    before: (locale) => <RegisterFallback locale={locale} state="filling" />,
    screen: (locale) => <RegisterFallback locale={locale} state="done" />,
  },
  {
    id: "unsigned",
    feature: "waivers",
    notes: ["marketing.home.steps.unsigned.note1", "marketing.home.steps.unsigned.note2"],
    label: "marketing.home.steps.unsigned.mockupLabel",
    before: (locale) => <FrontDeskReadinessFallback locale={locale} state="unsigned" />,
    screen: (locale) => <FrontDeskReadinessFallback locale={locale} state="nudged" />,
  },
  {
    id: "sign",
    listed: true,
    typed: true,
    feature: "waivers",
    notes: ["marketing.home.steps.sign.note1", "marketing.home.steps.sign.note2"],
    label: "marketing.home.steps.sign.mockupLabel",
    before: (locale) => <WaiverSigningFallback locale={locale} state="filling" />,
    screen: (locale) => <WaiverSigningFallback locale={locale} state="signed" />,
  },
  {
    // The readiness list a reader without the player sees: the boarding check's own rows.
    id: "check",
    listed: true,
    feature: "certifications",
    notes: ["marketing.home.steps.check.note1", "marketing.home.steps.check.note2"],
    label: "marketing.home.steps.check.readyLabel",
    before: (locale) => <FrontDeskReadinessFallback locale={locale} state="nudged" />,
    screen: (locale) => <FrontDeskReadinessFallback locale={locale} state="ready" />,
  },
  {
    id: "card",
    feature: "certifications",
    notes: ["marketing.home.steps.card.note1", "marketing.home.steps.card.note2"],
    label: "marketing.home.steps.card.mockupLabel",
    before: (locale) => <CardCheckFallback locale={locale} state="pending" />,
    screen: (locale) => <CardCheckFallback locale={locale} state="certified" />,
  },
  {
    id: "desk",
    feature: "check-in",
    notes: ["marketing.home.steps.desk.note1", "marketing.home.steps.desk.note2"],
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
    notes: ["marketing.home.steps.aboard.note1", "marketing.home.steps.aboard.note2"],
    label: "marketing.home.steps.aboard.boatLabel",
    before: (locale) => <CaptainRollCallFallback locale={locale} state="afterDivePending" />,
    screen: (locale) => <CaptainRollCallFallback locale={locale} state="afterDive" />,
  },
  {
    // The report goes out by itself a few hours after the boat is due back, which is why it is the
    // messages page this slide opens. Its drawing carries the label `RecapPageFallback` names.
    id: "recap",
    listed: true,
    feature: "messages",
    notes: ["marketing.home.steps.recap.note1", "marketing.home.steps.recap.note2"],
    label: "marketing.home.steps.recap.mockupLabel",
    before: (locale) => <RecapPageFallback locale={locale} view="report" />,
    screen: (locale) => <RecapPageFallback locale={locale} view="report" />,
  },
  {
    id: "review",
    typed: true,
    feature: "messages",
    notes: ["marketing.home.steps.review.note1", "marketing.home.steps.review.note2"],
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
