import { localeEndonym } from "@/i18n/language-labels";
import { DIVER_LOCALES } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import type { ShopSwitchesOn } from "@/lib/shop-features";
import type { StaffDestinationGates } from "@/lib/staff-destinations";
import { commandPaletteCopy, signOutAction } from "./command-palette-props";
import { LazyCommandPalette } from "./search/LazyCommandPalette";

/**
 * **The ⌘K search as a field of its own**, for a page that stands outside the
 * staff shell and so has no bar to put it in: the staff 404, which is a dead
 * end without it (UX review 2026-10-10, item 38). The same palette, the same
 * gates and the same words as the bar's, drawn as a full-width field. Loaded
 * through `LazyCommandPalette`, because the root 404 is in every route's
 * client graph.
 */
export function ShopSearchField({
  shopSlug,
  navGates,
  switches,
  locale,
  setLocale,
  createDiverAction,
}: {
  shopSlug: string;
  navGates: StaffDestinationGates;
  switches: ShopSwitchesOn;
  locale: string;
  setLocale: (locale: string) => Promise<void>;
  createDiverAction: (formData: FormData) => Promise<void>;
}) {
  const t = staffTranslator(locale);
  return (
    <LazyCommandPalette
      variant="field"
      shopSlug={shopSlug}
      gates={navGates}
      switches={switches}
      locale={locale}
      languages={DIVER_LOCALES.map((value) => ({ locale: value, label: localeEndonym(value) }))}
      setLocaleAction={setLocale}
      signOutAction={signOutAction}
      createDiverAction={createDiverAction}
      copy={commandPaletteCopy(t)}
    />
  );
}
