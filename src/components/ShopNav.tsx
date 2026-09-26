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
  type StaffDestinationGates,
  type StaffDestinationId,
  type StaffDestinationLabels,
  type StaffDestinationTitles,
  staffDestination,
  staffDestinationHref,
  staffShopRoot,
} from "@/lib/staff-destinations";
import { ShopPlaceMenu, ShopPlaceNav, type ShopPlaceNavCopy } from "./ShopPlaceNav";
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
  /** Owner/manager surfaces (H-14) to hide from the bar and search for everyone else. */
  navGates: StaffDestinationGates;
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
  // Shared by the desk bar's pills and the phone's folded calendar, so a
  // badge can never say different things in the two places it renders.
  const badgeLabels = {
    blockers: t("shared.shopNavLinks.badgeBlocked", {
      count: navCounts?.blockers ?? 0,
    }),
  };
  // One record, read by both forms of the same nav — the desk bar's pills and
  // the phone's calendar — so the two cannot come to disagree about what a
  // time is called.
  const placeCopy: ShopPlaceNavCopy = {
    navAriaLabel: t("shared.shopPlaceNav.navAriaLabel"),
    places: {
      day: t("shared.shopPlaceNav.today"),
      week: t("shared.shopPlaceNav.week"),
      season: t("shared.shopPlaceNav.season"),
    },
    blockedLabel: badgeLabels.blockers,
  };
  return (
    <>
      {/*
       * The one bar both shells wear — 56px, the page background behind a
       * blur, one hairline, no shadow (ADR
       * 20260827-clearwater-surface-language, decision 10).
       *
       * What it carries is now the whole of Tide's answer to "where am I":
       * the shop's name, the three times, and the search (ADR
       * 20260919-one-idea, slice 23b). From `lg` up the three stand as pills
       * in the centre slot; below it they fold into the calendar beside the
       * search, because the bar is a fixed height and nothing in it may wrap —
       * every slot shrinks instead, and a long shop name ellipses (see
       * ShopIdentityMenu: its button shrinks, down to the 44px `min-w-11`
       * round the mark, and its label carries `min-w-0`).
       */}
      <ChromeBar
        staffChrome
        leading={
          /* The identity block is the shop's own disclosure — Settings,
             then this reader's language and the way out — rather than
             standing in permanent chrome: the rarest controls in the header
             do not get all-day screen time (principle 10). Settings is here
             because it is the one place with no hour in it and there is no
             nav left to hold it (ADR 20260919-one-idea, slice 23b); home
             stays one tap away as Today, in the three times beside this. */
          <div className="flex min-w-0 shrink items-center">
            <ShopIdentityMenu
              shopName={shopName}
              logoUrl={logoUrl}
              // The one place with no hour in it, behind the shop's own name —
              // and absent rather than refusing for a role that may not open
              // it (ADR 20260919-one-idea, slice 23b).
              settingsHref={
                navGates.settings
                  ? staffDestinationHref(root, staffDestination("settings"))
                  : undefined
              }
              signOutAction={signOutAction}
              locale={locale}
              languages={languages}
              setLocaleAction={setLocale}
              copy={{
                settings: t("shared.shopNavLinks.settings"),
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
                storefront and no-ops.

                Empty in the markup — the page fills it after mount — and
                `aria-hidden`, because it is a second copy of a heading the page
                already renders and the bar's accessible name stays the shop's.
                `max-w-0` at rest so the label costs the row nothing wherever
                the fold does not run — no scroll-driven animations, `lg` and
                up, or a reduced-motion reader — and the fold gives it the width
                the shop's name lets go of.

                The shop name's own line box, `leading-6`: 24px, the name's
                16px at the body's 1.5. The row centres both boxes on the mark,
                and where a box's top lands decides the pixel row its baseline
                snaps to — the name's starts on a half pixel. The title's own
                box, 17px under `leading-none` and 25.5px inherited, started on
                a whole one, and its cap sat 1px above the mark's centre and
                the name it replaces (K-502). */}
            <span
              data-chrome-title-slot
              aria-hidden
              className="max-w-0 min-w-0 truncate text-[17px] leading-6 font-semibold tracking-tight opacity-0"
            />
          </div>
        }
        center={
          /* **The three times, and nothing else** (ADR 20260919-one-idea,
             slice 23b). Five noun tabs, a "More" menu and a phone dock all
             left with the nav they belonged to; what stands is Today, Week
             and Season, which is what the desk bar is drawn with. Below `lg`
             these give way to the calendar in the trailing slot — the same
             three, folded, because the bar is a fixed height and nothing in
             it may wrap. */
          <ShopPlaceNav
            root={root}
            gates={navGates}
            blocked={navCounts?.blockers}
            copy={placeCopy}
            className="hidden lg:flex"
          />
        }
        trailing={
          <>
            {/* **The date the phone's bar carries**, drawn as the calendar
                `Tide.dc.html`'s pocket puts left of the magnifier. It is the
                fold of the centre slot's pills and nothing more: one registry
                read, one set of words, one answer about which time is lit. */}
            <ShopPlaceMenu
              root={root}
              gates={navGates}
              blocked={navCounts?.blockers}
              copy={placeCopy}
              className="lg:hidden"
            />
            {/* Trips are created from the Schedule, where the surrounding week
                is visible. */}
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
    </>
  );
}
