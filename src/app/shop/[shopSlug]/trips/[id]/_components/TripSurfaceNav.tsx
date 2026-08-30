import { staffTranslator } from "@/i18n/staff-messages";
import { TripSubNav, type TripSubNavCopy } from "./TripSubNav";

/**
 * The localized three-surface spine for a departure. It stays server-side so
 * staff copy is resolved before the pathname-reading client nav hydrates.
 *
 * The roster no longer owns a tab in slice 5e: its ledger is the body of Trip.
 * Keeping this small adapter separate means the old `/guests` compatibility
 * route and the three live surfaces use exactly the same words and links.
 */
export function TripSurfaceNav({
  shopSlug,
  tripId,
  locale,
}: {
  shopSlug: string;
  tripId: string;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const copy: TripSubNavCopy = {
    ariaLabel: t("trips.subNav.ariaLabel"),
    trip: t("trips.subNav.trip"),
    manifest: t("trips.subNav.manifest"),
    prep: t("trips.subNav.prep"),
  };
  return <TripSubNav shopSlug={shopSlug} tripId={tripId} copy={copy} className="w-full" />;
}
