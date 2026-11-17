import type { ReactNode } from "react";
import { ArrivalDeskFallback } from "@/components/MarketingArrivalDeskFallback";
import { WaiverSigningFallback } from "@/components/MarketingFeatureScreens";
import {
  CaptainRollCallFallback,
  DiverBookingFallback,
  FrontDeskReadinessFallback,
  RecapPageFallback,
} from "@/components/MarketingScreenFallbacks";
import type { DiverMessageKey } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { FeaturePageSlug } from "@/lib/feature-pages";

/**
 * One booking, followed from the shop's website to the boat and home again
 * (H-20261005-public-pages-sell, the 2026-10-05 rework). Each step is the screen that does it, two of
 * the builder's notes beside it, and a link to the feature page that tells the
 * rest. The order is the order a diver meets the shop in, which is also the
 * order an owner's doubts arrive in: will they book, does the paperwork come
 * back, who catches the diver who isn't cleared, does the roll call on the
 * boat hold, and what does the diver take home.
 *
 * Five steps, not the six the rework first drew: check-in at the counter was
 * cut in review, because its screen read as the readiness step's twin and its
 * one claim was the band's only one any rival makes. The directory below still
 * links its page.
 *
 * A step ends in its feature page rather than in a door into the demo, as the
 * rows here did until 2026-10-05: the feature page's own door opens the demo
 * on that very screen, as the role that uses it, which a door here could only
 * do by repeating it. The page keeps its two demo doors, hero and close.
 *
 * A step that draws a feature page's own screen reads that page's notes and
 * label by key (the release on the diver's phone), and the readiness step
 * quotes the certifications page's line about its rows, so the homepage and a
 * feature page can never describe one drawing two ways. The rest keep the
 * drawings and notes this page carries under `marketing.home.steps`.
 *
 * `id` is the bundle namespace under `marketing.home.steps`, never a rendered
 * string.
 */
export const STEPS: readonly {
  id: "book" | "sign" | "check" | "aboard" | "recap";
  feature: FeaturePageSlug;
  notes: readonly [DiverMessageKey, DiverMessageKey, ...DiverMessageKey[]];
  /**
   * The step's drawn screens, in the order the walk shows them. The one marked
   * `primary` is what a reader without the player sees; the others are in the
   * page for the walk and hidden until it runs (`WALK_CLASSES`).
   */
  frames: readonly {
    id: string;
    label: DiverMessageKey;
    primary?: true;
    /**
     * The screen a moment before the tap this frame's beat is about, with the
     * tapped control marked `data-tap-target`. The player shows it first,
     * pulses the control, then swaps to `screen`; a reader without the player
     * sees `screen` only.
     */
    before?: (locale: DiverLocale) => ReactNode;
    screen: (locale: DiverLocale) => ReactNode;
  }[];
}[] = [
  {
    id: "book",
    feature: "online-booking",
    notes: ["marketing.home.steps.book.note1", "marketing.home.steps.book.note2"],
    frames: [
      {
        id: "booking",
        label: "marketing.home.steps.book.mockupLabel",
        primary: true,
        screen: (locale) => <DiverBookingFallback locale={locale} />,
      },
    ],
  },
  {
    id: "sign",
    feature: "waivers",
    notes: ["marketing.featurePages.waivers.note1", "marketing.featurePages.waivers.note3"],
    frames: [
      {
        id: "signing",
        label: "marketing.featurePages.waivers.screenLabel",
        primary: true,
        screen: (locale) => <WaiverSigningFallback locale={locale} />,
      },
    ],
  },
  {
    id: "check",
    feature: "certifications",
    notes: ["marketing.featurePages.certifications.note3", "marketing.home.steps.check.note2"],
    frames: [
      {
        id: "unsigned",
        label: "marketing.home.steps.check.mockupLabel",
        screen: (locale) => <FrontDeskReadinessFallback locale={locale} state="unsigned" />,
      },
      {
        id: "ready",
        label: "marketing.home.steps.check.readyLabel",
        primary: true,
        screen: (locale) => <FrontDeskReadinessFallback locale={locale} state="ready" />,
      },
    ],
  },
  {
    // The hero draws the dock's roll-call phone, so this step draws the same
    // screen a dive later, after the desk (B14, 2026-10-25); the notes keep
    // H-20260802-may-public-pages-say's no-signal claim.
    id: "aboard",
    feature: "boat-manifest",
    // The third note is for the owner who still carries paper (issue #4322):
    // the same manifest prints, and the step's link is the boat-manifest page
    // that lists the packet.
    notes: [
      "marketing.home.steps.aboard.note1",
      "marketing.home.steps.aboard.note2",
      "marketing.home.steps.aboard.note3",
    ],
    frames: [
      {
        id: "desk",
        label: "marketing.home.steps.aboard.deskLabel",
        before: (locale) => <ArrivalDeskFallback locale={locale} state="ready" />,
        screen: (locale) => <ArrivalDeskFallback locale={locale} state="checkedIn" />,
      },
      {
        id: "boat",
        label: "marketing.home.steps.aboard.boatLabel",
        primary: true,
        before: (locale) => <CaptainRollCallFallback locale={locale} state="afterDivePending" />,
        screen: (locale) => <CaptainRollCallFallback locale={locale} state="afterDive" />,
      },
    ],
  },
  {
    // The recap goes out by itself a few hours after the boat is due back,
    // which is why it is the messages page this step opens.
    id: "recap",
    feature: "messages",
    notes: ["marketing.home.steps.recap.note1", "marketing.home.steps.recap.note2"],
    frames: [
      {
        id: "recap",
        label: "marketing.home.steps.recap.mockupLabel",
        primary: true,
        screen: (locale) => <RecapPageFallback locale={locale} />,
      },
    ],
  },
];

/**
 * The walkthrough, in the order Priya's day goes (not the list's order: the
 * morning list comes up twice, once with her waiver open and once after she
 * signs). Seven beats at about thirteen seconds is the ninety. Each names a
 * step and one of its frames; the caption is
 * `marketing.home.walk.captions.<caption>`.
 */
export const WALK: readonly {
  step: (typeof STEPS)[number]["id"];
  frame: string;
  caption: "book" | "unsigned" | "sign" | "ready" | "desk" | "boat" | "recap";
}[] = [
  { step: "book", frame: "booking", caption: "book" },
  { step: "check", frame: "unsigned", caption: "unsigned" },
  { step: "sign", frame: "signing", caption: "sign" },
  { step: "check", frame: "ready", caption: "ready" },
  { step: "aboard", frame: "desk", caption: "desk" },
  { step: "aboard", frame: "boat", caption: "boat" },
  { step: "recap", frame: "recap", caption: "recap" },
];

/**
 * What the list does once the player has marked it (`data-walk`): one step,
 * one screen. Without the mark (no script, or before it runs) every step shows
 * and each shows only its primary screen, which is the list this page always
 * was.
 *
 * A frame with a `before` draws both screens in one grid cell (so the frame
 * never changes height) and the player's `data-walk-phase` says which shows:
 * `before`, then `tap` (the same screen, its `data-tap-target` pulsing), then
 * `after`. With no phase (no script, reduced motion, a paused walk) the
 * finished screen shows.
 */
export const WALK_CLASSES =
  "[&:not([data-walk])_[data-walk-frame]:not([data-walk-primary])]:hidden [&[data-walk]>li:not([data-walk-current])]:hidden [&[data-walk]_[data-walk-frame]:not([data-walk-frame-current])]:hidden [&:not([data-walk-phase=before]):not([data-walk-phase=tap])_[data-walk-before]]:invisible [&[data-walk-phase=before]_[data-walk-after]]:invisible [&[data-walk-phase=tap]_[data-walk-after]]:invisible";
