import type { LanguageChoice } from "@/components/LanguageChoices";
import { ShopIdentityMenu } from "@/components/ShopIdentityMenu";
import { localeEndonym } from "@/i18n/language-labels";
import { DIVER_LOCALES } from "@/i18n/settings";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { signOut } from "@/lib/auth";
import { type StaffDestinationLabels, staffShopRoot } from "@/lib/staff-destinations";
import {
  type ShopNavCounts,
  type ShopNavGates,
  ShopNavLinks,
  type ShopNavLinksCopy,
} from "./ShopNavLinks";
import { StaffTabBar } from "./StaffTabBar";
import { CommandPalette } from "./search/CommandPalette";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

/**
 * The one word each staff destination goes by. The nav tabs and the palette's
 * "Go to" rows both read this record, so the two can no longer call the same
 * page different things — or, as before, know about different pages entirely. Typed against `StaffDestinationId`, so
 * adding a destination to the registry is a type error here until it has a word.
 */
function destinationLabelsFor(t: (key: StaffMessageKey) => string): StaffDestinationLabels {
  return {
    today: t("shared.shopNavLinks.today"),
    checkIn: t("shared.shopNavLinks.checkIn"),
    closeOut: t("shared.shopNavLinks.closeOut"),
    walkIn: t("shared.shopNavLinks.walkIn"),
    blockers: t("shared.shopNavLinks.blockers"),
    divers: t("shared.shopNavLinks.divers"),
    board: t("shared.shopNavLinks.board"),
    addBooking: t("shared.shopNavLinks.addBooking"),
    staffing: t("shared.shopNavLinks.staffing"),
    diveSites: t("shared.shopNavLinks.diveSites"),
    courses: t("shared.shopNavLinks.courses"),
    reviews: t("shared.shopNavLinks.reviews"),
    orders: t("shared.shopNavLinks.orders"),
    waivers: t("shared.shopNavLinks.waivers"),
    reports: t("shared.shopNavLinks.reports"),
    promoCodes: t("shared.shopNavLinks.promoCodes"),
    settings: t("shared.shopNavLinks.settings"),
    team: t("shared.shopNavLinks.team"),
    calendarFeed: t("shared.shopNavLinks.calendarFeed"),
  };
}

export function ShopNav({
  shopSlug,
  shopName,
  boatBoardingHref,
  navGates,
  navCounts,
  locale,
  setLocale,
}: {
  shopSlug: string;
  shopName: string;
  /** Today's next departure's boarding, when the shop has a boat out today. */
  boatBoardingHref?: string;
  /** Owner/manager surfaces (H-14) to hide from the nav and search for everyone else. */
  navGates: ShopNavGates;
  /** Small pending-work counts for the Reviews/Blockers nav badges (task 83). */
  navCounts?: ShopNavCounts;
  locale: string;
  /**
   * Remembers a language the reader picked (`setLocaleAction`). Passed in
   * rather than imported: `src/components` may not import `src/app`
   * (`pnpm check:architecture`), and the action is shared with the public
   * shop header, so one definition has to reach both from above.
   */
  setLocale: (locale: string) => Promise<void>;
}) {
  const root = staffShopRoot(shopSlug);
  const t = staffTranslator(locale);
  // Each language named in itself, resolved from CLDR rather than a bundle:
  // the reader who needs this control is the one who cannot read the bundle
  // currently in force (src/i18n/language-labels.ts).
  const languages: LanguageChoice[] = DIVER_LOCALES.map((value) => ({
    locale: value,
    label: localeEndonym(value),
  }));
  const destinationLabels = destinationLabelsFor(t);
  // Shared by the header tabs and the phone dock, so a badge can never say
  // different things in the two places the same destination renders.
  const badgeLabels = {
    blockers: t("shared.shopNavLinks.badgeBlocked", {
      count: navCounts?.blockers ?? 0,
    }),
  };
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-surface px-4 py-3 shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-surface/95 print:hidden sm:px-6">
        {/*
         * One row, always. Below `lg` the primary destinations live in the
         * phone dock (StaffTabBar, fixed to the bottom edge where a thumb
         * actually is) rather than wrapping into extra header rows, so the
         * header keeps to identity, search, and sign-out on every width; from
         * `lg` up the tab strip joins the row via the `order` utilities.
         */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2">
          {/* The identity block is this reader's own disclosure — language
              and Sign out — rather than standing in permanent chrome: the
              rarest controls in the header do not get all-day screen time
              (principle 10). Places in the shop (Settings included) live in
              the nav's More groups instead. Home stays one tap away as
              Today, in the tabs and the dock. */}
          {/* Below `lg` it is also the row's one flexible item, so a long shop
              name gets the width the tabs vacated. `flex-1` rather than a bare
              `min-w-0`: this row wraps, and wrapping is decided on an item's
              *hypothetical* size, which a zero minimum doesn't shrink — an
              uncapped name pushed the header into a second row at 360px
              instead of ellipsing, where a zero flex basis has nothing to push
              with. The inner `flex` keeps the button content-sized, so a short
              name leaves no header-wide tap target. From `lg` the tab strip is
              the flexible one and this sits at its own width again. */}
          {/* `lg:flex-initial`, not `lg:flex-none`: at `lg` this sizes to the
              name rather than to a share of the row, but it must still be
              *able* to shrink, because the name itself no longer carries a
              max-width clamp (see ShopIdentityMenu). `flex-none` pins
              `flex-shrink: 0`, which would let a long shop name push the tab
              strip instead of ellipsing. */}
          <div className="flex min-w-0 flex-1 lg:order-1 lg:flex-initial">
            <ShopIdentityMenu
              shopName={shopName}
              signOutAction={signOutAction}
              locale={locale}
              languages={languages}
              setLocaleAction={setLocale}
              copy={{
                language: t("shared.shopNav.language"),
                signOut: t("shared.shopNav.signOut"),
                signOutConfirm: t("shared.shopNav.signOutConfirm"),
                signOutPending: t("shared.shopNav.signOutPending"),
              }}
            />
          </div>
          {/* Trips are created from the Schedule, where the surrounding week is visible. */}
          <div className="ml-auto flex shrink-0 items-center gap-2 lg:order-3 lg:ml-0 lg:gap-3">
            <CommandPalette
              shopSlug={shopSlug}
              boatBoardingHref={boatBoardingHref}
              gates={navGates}
              locale={locale}
              languages={languages}
              setLocaleAction={setLocale}
              signOutAction={signOutAction}
              copy={{
                language: t("shared.shopNav.language"),
                groupSession: t("shared.commandPalette.groupSession"),
                signOut: t("shared.shopNav.signOut"),
                search: t("shared.commandPalette.search"),
                dialogAriaLabel: t("shared.commandPalette.dialogAriaLabel"),
                comboboxAriaLabel: t("shared.commandPalette.comboboxAriaLabel"),
                placeholder: t("shared.commandPalette.placeholder"),
                emptyShort: t("shared.commandPalette.emptyShort"),
                emptyNoMatches: t("shared.commandPalette.emptyNoMatches"),
                groupDivers: t("shared.commandPalette.groupDivers"),
                groupTrips: t("shared.commandPalette.groupTrips"),
                groupDiveSites: t("shared.commandPalette.groupDiveSites"),
                groupCourses: t("shared.commandPalette.groupCourses"),
                groupOrders: t("shared.commandPalette.groupOrders"),
                groupGoTo: t("shared.commandPalette.groupGoTo"),
                destinationLabels,
                goToBoarding: t("shared.commandPalette.goToBoarding"),
                goToOfflineRollCall: t("shared.commandPalette.goToOfflineRollCall"),
              }}
            />
          </div>
          <ShopNavLinks
            root={root}
            gates={navGates}
            counts={navCounts}
            copy={
              {
                primaryNavAriaLabel: t("shared.shopNavLinks.primaryNavAriaLabel"),
                more: t("shared.shopNavLinks.more"),
                groupDaily: t("shared.shopNavLinks.groupDaily"),
                groupSetup: t("shared.shopNavLinks.groupSetup"),
                labels: destinationLabels,
                // Resolved for the count each badge actually carries, so the
                // sr-only noun is pluralised rather than assembled from a digit
                // and a bare word.
                badgeLabels,
              } satisfies ShopNavLinksCopy
            }
            className="hidden lg:order-2 lg:flex lg:w-auto lg:flex-1"
          />
        </div>
      </header>
      <StaffTabBar
        root={root}
        gates={navGates}
        counts={navCounts}
        labels={destinationLabels}
        navAriaLabel={t("shared.shopNavLinks.primaryNavAriaLabel")}
        badgeLabels={badgeLabels}
        moreLabel={t("shared.shopNavLinks.more")}
        groupDailyLabel={t("shared.shopNavLinks.groupDaily")}
        groupSetupLabel={t("shared.shopNavLinks.groupSetup")}
      />
    </>
  );
}
