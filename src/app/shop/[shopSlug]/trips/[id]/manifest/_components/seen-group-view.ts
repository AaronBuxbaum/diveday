import type { listShopPickedSpecies, listTripSightings } from "@/db/trip-sightings";
import type { listTripDives } from "@/db/trips";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { seenChipSlugs, seenSiteFor } from "@/lib/sightings";
import { hasSailed } from "@/lib/trips";
import { deleteSightingAction, type ManifestActionContext, recordSightingAction } from "../actions";
import { matchSightingsAction } from "../sightings-assist-action";
import type { ManifestSpecies } from "./manifest-species";

/**
 * **The living reef's group, or nothing**: which site this checkpoint's taps
 * attach to, the chips the crew may tap and the tallies already logged there,
 * with the two actions bound to that site. `null` at the dock, on a boat that
 * has not left, and for a dive with nowhere to belong.
 */
export function seenGroupView({
  checkpoint,
  actionContext,
  departureStartsAt,
  executedDives,
  plannedDives,
  loggedSightings,
  shopPickedSpecies,
  catalogSpecies,
  speciesBySite,
  canAssist = false,
  sightingsOn = true,
  t,
}: {
  checkpoint: RollCallCheckpoint;
  actionContext: ManifestActionContext;
  departureStartsAt: Date;
  executedDives: ReadonlyArray<{
    executed: { diveNumber: number };
    actualSite: { id: string; name: string } | null;
  }>;
  plannedDives: Awaited<ReturnType<typeof listTripDives>>;
  loggedSightings: Awaited<ReturnType<typeof listTripSightings>>;
  shopPickedSpecies: Awaited<ReturnType<typeof listShopPickedSpecies>>;
  catalogSpecies: readonly ManifestSpecies[];
  speciesBySite: Record<string, readonly ManifestSpecies[]>;
  /** Claude's "say what you saw" (the `sightings` assist) is available. */
  canAssist?: boolean;
  /**
   * Whether the shop has sightings on (Features). Off, there is no Seen group;
   * every sighting stays logged.
   */
  sightingsOn?: boolean;
  t: StaffTranslator;
}) {
  if (!sightingsOn) return null;
  // **Which reef these taps attach to.**
  //
  // **A recorded dive speaks for itself, and a plan only speaks for a dive with
  // no record.** The two used to fall through one `??`, so a crew that recorded
  // the actual site as *unknown* — the boat went somewhere else, or the dive was
  // aborted — had their taps quietly attributed to the reef on the plan, and
  // that attribution is what a diver later reads as "seen here". A saved null is
  // staff saying they do not know where they were; the honest response is no
  // group at all, and the dive log one disclosure above is where they say where
  // they actually went.
  //
  // A dive with no site either way renders nothing: "seen here this month" is a
  // claim about a place, and a sighting with nowhere to belong has no reader.
  const seenDiveNumber = Number(/^after_dive_(\d+)$/.exec(checkpoint)?.[1] ?? 0);
  const seenSite = seenSiteFor({
    recorded: executedDives.find((row) => row.executed.diveNumber === seenDiveNumber),
    planned: plannedDives.find(({ dive }) => dive.diveNumber === seenDiveNumber)?.diveSite ?? null,
  });
  // **And a boat that has not left has seen nothing.** A checkpoint is a query
  // parameter, so the after-dive view is reachable at the dock; the write
  // refuses a tap there as well, and this is what keeps the crew from meeting
  // that refusal instead of an absent group.
  const seenDeparted = hasSailed(departureStartsAt, nowDate());
  // A slug with no card is dropped rather than rendered raw — the same rule
  // `fieldGuideCards` follows for a species DiveDay has since retired.
  const speciesName = new Map<string, string>(
    catalogSpecies.map((entry) => [entry.slug, entry.name]),
  );
  const seenTallies = seenSite
    ? loggedSightings.flatMap((row) => {
        const name = speciesName.get(row.speciesSlug);
        if (row.diveSiteId !== seenSite.id || !name) return [];
        return [
          {
            slug: row.speciesSlug,
            name,
            count: row.count,
            deleteLabel: t("manifest.seen.deleteNamed", { species: name }),
          },
        ];
      })
    : [];
  const seenChips = seenSite
    ? seenChipSlugs({
        siteGuide: (speciesBySite[seenSite.id] ?? []).map((entry) => entry.slug),
        shopPicks: shopPickedSpecies,
        catalog: catalogSpecies.map((entry) => entry.slug),
      }).flatMap((slug) => {
        const name = speciesName.get(slug);
        return name ? [{ slug, name }] : [];
      })
    : [];
  const sightingContext = seenSite ? { ...actionContext, diveSiteId: seenSite.id } : null;
  const boundRecordSightingAction = sightingContext
    ? recordSightingAction.bind(null, sightingContext)
    : null;
  const boundDeleteSightingAction = sightingContext
    ? deleteSightingAction.bind(null, sightingContext)
    : null;
  if (
    checkpoint === "departure" ||
    !seenDeparted ||
    !seenSite ||
    !boundRecordSightingAction ||
    !boundDeleteSightingAction
  ) {
    return null;
  }
  return {
    chips: seenChips,
    tallies: seenTallies,
    copy: {
      heading: t("manifest.seen.heading"),
      consequence: t("manifest.seen.consequence", { site: seenSite.name }),
      delete: t("manifest.seen.delete"),
      refusal: t("manifest.seen.refusal"),
      offlineLabel: t("manifest.seen.offlineLabel"),
      connectivity: {
        online: t("shared.connectivity.online"),
        onlineTitle: t("shared.connectivity.onlineTitle"),
        offlineTitle: t("shared.connectivity.offlineTitle"),
      },
    },
    recordAction: boundRecordSightingAction,
    deleteAction: boundDeleteSightingAction,
    match:
      canAssist && sightingContext && seenChips.length > 0
        ? {
            action: matchSightingsAction.bind(
              null,
              sightingContext,
              seenChips.map((chip) => chip.slug),
            ),
            copy: {
              label: t("deskAssists.sightings.label"),
              match: t("deskAssists.sightings.match"),
              matching: t("deskAssists.sightings.matching"),
              add: t("deskAssists.sightings.add"),
              adding: t("deskAssists.sightings.adding"),
              none: t("deskAssists.sightings.none"),
              proposed: t.raw("deskAssists.sightings.proposed"),
            },
          }
        : undefined,
  };
}
