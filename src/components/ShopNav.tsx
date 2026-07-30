import Link from "next/link";
import { KeyboardShortcuts, type KeyboardShortcutsCopy } from "@/components/KeyboardShortcuts";
import { LogoMark } from "@/components/Logo";
import { staffTranslator } from "@/i18n/staff-messages";
import { signOut } from "@/lib/auth";
import { type ShopNavGates, ShopNavLinks } from "./ShopNavLinks";
import { CommandPalette } from "./search/CommandPalette";
import { buttonClass } from "./ui/button";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export function ShopNav({
  shopSlug,
  shopName,
  boatBoardingHref,
  navGates,
  locale,
}: {
  shopSlug: string;
  shopName: string;
  /** Today's next departure's boarding, when the shop has a boat out today. */
  boatBoardingHref?: string;
  /** Owner/manager surfaces (H-14) to hide from nav, shortcuts, and search for everyone else. */
  navGates: ShopNavGates;
  locale: string;
}) {
  const root = `/shop/${shopSlug}`;
  const t = staffTranslator(locale);
  const baseNavShortcuts = [
    { key: "t", suffix: "", page: t("shared.commandPalette.goToToday") },
    { key: "s", suffix: "/schedule", page: t("shared.commandPalette.goToSchedule") },
    { key: "d", suffix: "/divers", page: t("shared.commandPalette.goToDivers") },
    { key: "b", suffix: "/blockers", page: t("shared.commandPalette.goToBlockers") },
    ...(navGates.waivers
      ? [{ key: "w", suffix: "/waivers", page: t("shared.commandPalette.goToWaivers") }]
      : []),
  ];
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
    navShortcuts: baseNavShortcuts.map(({ key, suffix, page }) => ({
      key,
      suffix,
      goToLabel: t("shared.keyboardShortcuts.goToLabel", { page }),
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
            canManageWaivers={navGates.waivers}
            copy={{
              search: t("shared.commandPalette.search"),
              comboboxAriaLabel: t("shared.commandPalette.comboboxAriaLabel"),
              placeholder: t("shared.commandPalette.placeholder"),
              emptyShort: t("shared.commandPalette.emptyShort"),
              emptyNoMatches: t("shared.commandPalette.emptyNoMatches"),
              groupDivers: t("shared.commandPalette.groupDivers"),
              groupTrips: t("shared.commandPalette.groupTrips"),
              groupGoTo: t("shared.commandPalette.groupGoTo"),
              goToToday: t("shared.commandPalette.goToToday"),
              goToBlockers: t("shared.commandPalette.goToBlockers"),
              goToSchedule: t("shared.commandPalette.goToSchedule"),
              goToDivers: t("shared.commandPalette.goToDivers"),
              goToSettings: t("shared.commandPalette.goToSettings"),
              goToWaivers: t("shared.commandPalette.goToWaivers"),
              goToBoarding: t("shared.commandPalette.goToBoarding"),
            }}
          />
          <KeyboardShortcuts shopSlug={shopSlug} copy={keyboardShortcutsCopy} />
          <form action={signOutAction} className="shrink-0" data-scroll-reset="true">
            <button
              type="submit"
              aria-label={t("shared.shopNav.signOut")}
              className={buttonClass({ variant: "ghost", size: "sm", className: "rounded-xl" })}
            >
              {t("shared.shopNav.signOut")}
            </button>
          </form>
        </div>
        <ShopNavLinks
          root={root}
          gates={navGates}
          className="order-last w-full sm:order-2 sm:w-auto sm:flex-1"
        />
      </div>
    </header>
  );
}
