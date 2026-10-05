import type { ReactNode } from "react";
import {
  ArrivalDeskFallback,
  BookingCardFallback,
  CoursePageFallback,
  GearRegisterFallback,
  OrdersLedgerFallback,
  ScheduleWeekFallback,
  SiteBriefingFallback,
  StorefrontFallback,
  WaiverSigningFallback,
} from "@/components/MarketingFeatureScreens";
import {
  FrontDeskReadinessFallback,
  NightBeforeBriefFallback,
} from "@/components/MarketingScreenFallbacks";
import { CaptainPhoneFrame, MarketingMockup } from "@/components/MarketingSections";
import type { DiverLocale } from "@/i18n/settings";
import type { FeatureScreen as FeatureScreenCode } from "@/lib/feature-pages";

/**
 * The drawing for each code a feature page names (`src/lib/feature-pages.ts`).
 * A `Record` rather than a switch, so a screen added to the registry without a
 * drawing here is a type error instead of a blank panel.
 *
 * The roll call is the one phone: it is the screen a captain holds on the
 * deck, and the homepage and `/about` already draw it in the same bezel, so
 * the boat manifest page shows it the way a buyer has seen it everywhere else.
 * Its width is the page's to set (`FeaturePageBody` narrows the whole figure,
 * so the notes sit under the phone).
 */
const SCREENS: Record<
  Exclude<FeatureScreenCode, "rollCall">,
  (locale: DiverLocale) => ReactNode
> = {
  bookingCard: (locale) => <BookingCardFallback locale={locale} />,
  storefront: (locale) => <StorefrontFallback locale={locale} />,
  waiverSigning: (locale) => <WaiverSigningFallback locale={locale} />,
  readiness: (locale) => <FrontDeskReadinessFallback locale={locale} />,
  nightBefore: (locale) => <NightBeforeBriefFallback locale={locale} />,
  arrivalDesk: (locale) => <ArrivalDeskFallback locale={locale} />,
  siteBriefing: (locale) => <SiteBriefingFallback locale={locale} />,
  gearRegister: (locale) => <GearRegisterFallback locale={locale} />,
  scheduleWeek: (locale) => <ScheduleWeekFallback locale={locale} />,
  coursePage: (locale) => <CoursePageFallback locale={locale} />,
  ordersLedger: (locale) => <OrdersLedgerFallback locale={locale} />,
};

export function FeatureScreen({
  screen,
  label,
  locale,
}: {
  screen: FeatureScreenCode;
  /** What the drawing shows, resolved by the caller: it is the panel's `aria-label`. */
  label: string;
  locale: DiverLocale;
}) {
  if (screen === "rollCall") {
    return <CaptainPhoneFrame label={label} locale={locale} />;
  }
  return <MarketingMockup label={label}>{SCREENS[screen](locale)}</MarketingMockup>;
}
