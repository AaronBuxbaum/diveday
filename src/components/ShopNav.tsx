import Link from "next/link";
import { KeyboardShortcuts, type KeyboardShortcutsCopy } from "@/components/KeyboardShortcuts";
import { LogoMark } from "@/components/Logo";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { signOut } from "@/lib/auth";
import {
  type StaffDestinationLabels,
  staffDestinationSuffix,
  staffShopRoot,
  staffShortcutDestinations,
} from "@/lib/staff-destinations";
import {
  type ShopNavCounts,
  type ShopNavGates,
  ShopNavLinks,
  type ShopNavLinksCopy,
} from "./ShopNavLinks";
import { CommandPalette } from "./search/CommandPalette";
import { buttonClass } from "./ui/button";
import { InlineConfirm } from "./ui/InlineConfirm";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

/**
 * The one word each staff destination goes by. The nav tabs, the palette's
 * "Go to" rows, and the keyboard-shortcut sheet all read this record, so the
 * three can no longer call the same page different things — or, as before,
 * know about different pages entirely. Typed against `StaffDestinationId`, so
 * adding a destination to the registry is a type error here until it has a word.
 */
function destinationLabelsFor(t: (key: StaffMessageKey) => string): StaffDestinationLabels {
  return {
    today: t("shared.shopNavLinks.today"),
    checkIn: t("shared.shopNavLinks.checkIn"),
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
  };
}

export function ShopNav({
  shopSlug,
  shopName,
  boatBoardingHref,
  navGates,
  navCounts,
  locale,
}: {
  shopSlug: string;
  shopName: string;
  /** Today's next departure's boarding, when the shop has a boat out today. */
  boatBoardingHref?: string;
  /** Owner/manager surfaces (H-14) to hide from nav, shortcuts, and search for everyone else. */
  navGates: ShopNavGates;
  /** Small pending-work counts for the Reviews/Blockers nav badges (task 83). */
  navCounts?: ShopNavCounts;
  locale: string;
}) {
  const root = staffShopRoot(shopSlug);
  const t = staffTranslator(locale);
  const destinationLabels = destinationLabelsFor(t);
  const keyboardShortcutsCopy: KeyboardShortcutsCopy = {
    buttonAriaLabel: t("shared.keyboardShortcuts.buttonAriaLabel"),
    buttonTitle: t("shared.keyboardShortcuts.buttonTitle"),
    dialogAriaLabel: t("shared.keyboardShortcuts.dialogAriaLabel"),
    closeAriaLabel: t("shared.keyboardShortcuts.closeAriaLabel"),
    heading: t("shared.keyboardShortcuts.heading"),
    paletteLabel: t("shared.keyboardShortcuts.paletteLabel"),
    helpLabel: t("shared.keyboardShortcuts.helpLabel"),
    sequenceHint: t.rich("shared.keyboardShortcuts.sequenceHint", {
      kbdG: (chunks) => <kbd>{chunks}</kbd>,
      kbdS: (chunks) => <kbd>{chunks}</kbd>,
    }),
    // Derived from the destination registry, so the sheet lists exactly the
    // sequences that work — including none for a surface this role can't see.
    navShortcuts: staffShortcutDestinations(navGates).map((destination) => ({
      key: destination.shortcut,
      // Suffix *plus* any view query — `g b` selects Today's by-departure view,
      // which the bare suffix (the shop root) would silently drop.
      suffix: staffDestinationSuffix(destination),
      goToLabel: t("shared.keyboardShortcuts.goToLabel", {
        page: destinationLabels[destination.id],
      }),
    })),
  };
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 px-4 py-3 shadow-sm backdrop-blur print:hidden sm:px-6">
      {/*
       * On phones the primary links wrap to their own full-width row below the
       * logo instead of being crushed into whatever slice of the top row is
       * left over (which forced a cramped horizontal scroll). On sm+ everything
       * collapses back to a single row via the `order` utilities.
       */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href={root}
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight sm:order-1"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform duration-200 hover:rotate-6">
            <LogoMark className="size-5" />
            <span className="sr-only">{t("shared.shopNav.home")}</span>
          </span>
          <span className="hidden max-w-40 truncate sm:inline">{shopName}</span>
          <span className="sm:hidden">DiveDay</span>
        </Link>
        {/* Trips are created from the Schedule, where the surrounding week is visible. */}
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:order-3 sm:ml-0 sm:gap-3">
          <CommandPalette
            shopSlug={shopSlug}
            boatBoardingHref={boatBoardingHref}
            gates={navGates}
            copy={{
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
          <KeyboardShortcuts shopSlug={shopSlug} copy={keyboardShortcutsCopy} />
          <form action={signOutAction} className="shrink-0" data-scroll-reset="true">
            {/* Two-tap mis-tap protection (task 81): sits right beside Search,
                so one stray tap used to log the whole crew out mid-shift.
                Compact mode (no `message`) — an undo banner isn't safe here:
                the grace window it needs would keep the session (or a
                passwordless resume) alive briefly, and on a shared boat or
                front-desk device that's a window for whoever touches the
                device next to reclaim the previous login (principle 7). */}
            <InlineConfirm
              triggerLabel={t("shared.shopNav.signOut")}
              confirmLabel={t("shared.shopNav.signOutConfirm")}
              pendingLabel={t("shared.shopNav.signOutPending")}
              triggerClassName={buttonClass({
                variant: "ghost",
                size: "sm",
                className: "rounded-xl",
              })}
              confirmClassName={buttonClass({
                variant: "danger",
                size: "sm",
                className: "rounded-xl",
              })}
              autoResetMs={4000}
            />
          </form>
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
              badgeLabels: {
                blockers: t("shared.shopNavLinks.badgeBlocked", {
                  count: navCounts?.blockers ?? 0,
                }),
                reviews: t("shared.shopNavLinks.badgeReviews", { count: navCounts?.reviews ?? 0 }),
              },
            } satisfies ShopNavLinksCopy
          }
          className="order-last w-full sm:order-2 sm:w-auto sm:flex-1"
        />
      </div>
    </header>
  );
}
