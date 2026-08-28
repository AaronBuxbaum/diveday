import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChromeBar } from "@/components/chrome/ChromeBar";
import type { LanguageChoice } from "@/components/LanguageChoices";
import { ShopIdentityMenu } from "@/components/ShopIdentityMenu";
import { gearStatusLabels } from "@/i18n/gear-labels";
import { localeEndonym } from "@/i18n/language-labels";
import { DIVER_LOCALES } from "@/i18n/settings";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { getAuth } from "@/lib/auth";
import {
  STAFF_DESTINATION_LABEL_KEYS,
  STAFF_DESTINATION_TITLE_KEYS,
  type StaffDestinationId,
  type StaffDestinationLabels,
  type StaffDestinationTitles,
  staffShopRoot,
} from "@/lib/staff-destinations";
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
  const auth = await getAuth();
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}

/**
 * The one word each staff destination goes by, and the headline the page it
 * leads to wears.
 *
 * Both are read straight off the registry's key records, so the nav tab, the
 * palette's "Go to" row and the page's own eyebrow are the same string by
 * construction rather than by three people typing it. Adding a destination
 * without a word is a type error in `STAFF_DESTINATION_LABEL_KEYS`.
 */
function destinationLabelsFor(t: (key: StaffMessageKey) => string): StaffDestinationLabels {
  const entries = Object.entries(STAFF_DESTINATION_LABEL_KEYS) as [
    StaffDestinationId,
    StaffMessageKey,
  ][];
  return Object.fromEntries(entries.map(([id, key]) => [id, t(key)])) as StaffDestinationLabels;
}

/**
 * What each destination calls itself once you are on it, where that differs
 * from its label — so ⌘K finds Reports for somebody who types "how's my
 * month". Only the stable headlines; see `STAFF_DESTINATION_TITLE_KEYS`.
 */
function destinationTitlesFor(t: (key: StaffMessageKey) => string): StaffDestinationTitles {
  const entries = Object.entries(STAFF_DESTINATION_TITLE_KEYS) as [
    StaffDestinationId,
    StaffMessageKey,
  ][];
  return Object.fromEntries(entries.map(([id, key]) => [id, t(key)]));
}

export function ShopNav({
  shopSlug,
  shopName,
  logoUrl,
  boatBoardingHref,
  navGates,
  navCounts,
  locale,
  setLocale,
  createDiverAction,
}: {
  shopSlug: string;
  shopName: string;
  logoUrl?: string;
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
  createDiverAction: (formData: FormData) => Promise<void>;
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
  const destinationTitles = destinationTitlesFor(t);
  // Shared by the header tabs and the phone dock, so a badge can never say
  // different things in the two places the same destination renders.
  const badgeLabels = {
    blockers: t("shared.shopNavLinks.badgeBlocked", {
      count: navCounts?.blockers ?? 0,
    }),
  };
  return (
    <>
      {/*
       * The one bar both shells wear — 56px, the page background behind a
       * blur, one hairline, no shadow (ADR
       * 20260827-clearwater-surface-language, decision 10). Below `lg` the
       * primary destinations live in the phone dock (StaffTabBar, fixed to the
       * bottom edge where a thumb actually is) rather than wrapping into extra
       * header rows, so the bar keeps to identity and search on every width;
       * from `lg` up the tab strip joins it in the centre slot, which is where
       * the `order` utilities used to put it.
       *
       * The bar is a fixed height now, so nothing in it may wrap: every slot
       * shrinks instead, and a long shop name ellipses (see ShopIdentityMenu,
       * whose button and label both carry `min-w-0`).
       */}
      <ChromeBar
        leading={
          /* The identity block is this reader's own disclosure — language and
             Sign out — rather than standing in permanent chrome: the rarest
             controls in the header do not get all-day screen time (principle
             10). Places in the shop (Settings included) live in the nav's More
             groups instead. Home stays one tap away as Today, in the tabs and
             the dock. */
          <ShopIdentityMenu
            shopName={shopName}
            logoUrl={logoUrl}
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
        }
        center={
          /* `w-full` inside the bar's centre slot: the strip's own nav is the
             flexible item within it, so the "More" door lands at the slot's
             right edge and the tabs stay hugging the shop's name. */
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
            className="hidden w-full lg:flex"
          />
        }
        trailing={
          /* Trips are created from the Schedule, where the surrounding week is
             visible. */
          <CommandPalette
            shopSlug={shopSlug}
            boatBoardingHref={boatBoardingHref}
            gates={navGates}
            locale={locale}
            languages={languages}
            setLocaleAction={setLocale}
            signOutAction={signOutAction}
            createDiverAction={createDiverAction}
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
              addDiver: t("shared.commandPalette.addDiver"),
              groupTrips: t("shared.commandPalette.groupTrips"),
              groupDiveSites: t("shared.commandPalette.groupDiveSites"),
              groupCourses: t("shared.commandPalette.groupCourses"),
              groupOrders: t("shared.commandPalette.groupOrders"),
              groupGear: t("shared.commandPalette.groupGear"),
              // Every status worded here, where the translator is: `src/db`
              // returns the code (`src/i18n/gear-labels.ts` owns the words).
              gearStatuses: gearStatusLabels(t),
              groupGoTo: t("shared.commandPalette.groupGoTo"),
              destinationLabels,
              destinationTitles,
              goToBoarding: t("shared.commandPalette.goToBoarding"),
              goToOfflineRollCall: t("shared.commandPalette.goToOfflineRollCall"),
              hintMove: t("shared.commandPalette.hintMove"),
              hintOpen: t("shared.commandPalette.hintOpen"),
              hintClose: t("shared.commandPalette.hintClose"),
            }}
          />
        }
      />
      <StaffTabBar
        root={root}
        gates={navGates}
        counts={navCounts}
        labels={destinationLabels}
        closeOutLabel={t("shared.shopNavLinks.closeOutShort")}
        navAriaLabel={t("shared.shopNavLinks.primaryNavAriaLabel")}
        badgeLabels={badgeLabels}
        moreLabel={t("shared.shopNavLinks.more")}
        groupDailyLabel={t("shared.shopNavLinks.groupDaily")}
        groupSetupLabel={t("shared.shopNavLinks.groupSetup")}
      />
    </>
  );
}
