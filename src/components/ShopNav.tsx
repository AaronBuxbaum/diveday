import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChromeBar } from "@/components/chrome/ChromeBar";
import { ChromeTitleSlot } from "@/components/chrome/ChromeTitleSlot";
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
  type StaffDestinationGates,
  type StaffDestinationId,
  type StaffDestinationLabels,
  type StaffDestinationTitles,
  type StaffNavOffers,
  staffNavSections,
  staffShopRoot,
} from "@/lib/staff-destinations";
import { type ShopSectionNavCopy, ShopSidebar, ShopTabBar } from "./ShopSectionNav";
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

/**
 * The words both forms of the section nav read — the sidebar and the phone's
 * tab bar — resolved once so the two cannot call a section two things.
 */
function sectionNavCopy(
  t: ReturnType<typeof staffTranslator>,
  blockers: number,
): ShopSectionNavCopy {
  return {
    navAriaLabel: t("shared.shopSections.navAriaLabel"),
    sections: {
      today: t("shared.shopSections.today"),
      schedule: t("shared.shopSections.schedule"),
      divers: t("shared.shopSections.divers"),
      inbox: t("shared.shopSections.inbox"),
      money: t("shared.shopSections.money"),
      courses: t("shared.shopSections.courses"),
      gear: t("shared.shopSections.gear"),
      settings: t("shared.shopSections.settings"),
    },
    more: t("shared.shopSections.more"),
    blockedLabel: t("shared.shopNavLinks.badgeBlocked", { count: blockers }),
  };
}

/**
 * **The sidebar, from `lg` up** (ADR 20261001-logbook, decision 1). Rendered
 * by the staff layout beside the page rather than inside the bar, so it can
 * stand the full height under it.
 */
export function ShopNavSidebar({
  shopSlug,
  navGates,
  navOffers,
  navCounts,
  locale,
}: {
  shopSlug: string;
  navGates: StaffDestinationGates;
  navOffers: StaffNavOffers;
  navCounts?: { blockers: number };
  locale: string;
}) {
  const t = staffTranslator(locale);
  return (
    <ShopSidebar
      root={staffShopRoot(shopSlug)}
      gates={navGates}
      items={staffNavSections(navGates, navOffers)}
      blocked={navCounts?.blockers}
      copy={sectionNavCopy(t, navCounts?.blockers ?? 0)}
    />
  );
}

export function ShopNav({
  shopSlug,
  shopName,
  logoUrl,
  boatBoardingHref,
  navGates,
  navOffers,
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
  /** Owner/manager surfaces (H-14) to hide from the bar and search for everyone else. */
  navGates: StaffDestinationGates;
  /** Whether the shop teaches and keeps a fleet, so Courses and Gear show. */
  navOffers: StaffNavOffers;
  /** Divers held back by medical review, drawn on Today (task 83). */
  navCounts?: { blockers: number };
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
  const sectionCopy = sectionNavCopy(t, navCounts?.blockers ?? 0);
  return (
    <>
      {/* The one bar both shells wear (ADR 20260827-clearwater-surface-language,
          decision 10): the shop's name and the search. The sections are the
          sidebar beside the page from `lg` up and the tab bar below it (ADR
          20261001-logbook). */}
      <ChromeBar
        staffChrome
        leading={
          /* The identity block is the shop's name and this reader's own
             controls: their calendar feed, their language, the way out. The
             sections live in the nav (ADR 20261001-logbook). */
          <div className="flex min-w-0 shrink items-center">
            <ShopIdentityMenu
              shopName={shopName}
              logoUrl={logoUrl}
              signOutAction={signOutAction}
              locale={locale}
              languages={languages}
              setLocaleAction={setLocale}
              copy={{
                boatMode: t("shared.shopNav.boatMode"),
                language: t("shared.shopNav.language"),
                signOut: t("shared.shopNav.signOut"),
                signOutConfirm: t("shared.shopNav.signOutConfirm"),
                signOutPending: t("shared.shopNav.signOutPending"),
              }}
            />
            {/* **Where the page's title lands when the bar folds** (ADR
                20260907-nothing-from-nowhere, decision 5). Rendered here and
                nowhere else, which is what keeps the fold to the staff shell:
                `PublicShopChrome` composes the same `ChromeBar` and renders no
                slot, so `FoldedPageTitle`'s portal has no target on the
                storefront and no-ops. */}
            <ChromeTitleSlot />
          </div>
        }
        trailing={
          <>
            {/* Trips are created from the Schedule, where the surrounding week
                is visible. */}
            <CommandPalette
              shopSlug={shopSlug}
              boatBoardingHref={boatBoardingHref}
              gates={navGates}
              crewSchedule={navOffers.crew}
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
                goToCloseDay: t("shared.commandPalette.goToCloseDay"),
                goToOfflineRollCall: t("shared.commandPalette.goToOfflineRollCall"),
                hintMove: t("shared.commandPalette.hintMove"),
                hintOpen: t("shared.commandPalette.hintOpen"),
                hintClose: t("shared.commandPalette.hintClose"),
              }}
            />
          </>
        }
      />
      <ShopTabBar
        root={root}
        gates={navGates}
        items={staffNavSections(navGates, navOffers)}
        blocked={navCounts?.blockers}
        copy={sectionCopy}
      />
    </>
  );
}
