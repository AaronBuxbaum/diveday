import { InsetGroup } from "@/components/ui/ledger";
import { SettingsDoorRow } from "../SettingsRows";
import { BOATS_SITES_GROUP, SettingsGroup, type SettingsView } from "./kit";

/**
 * The Boats & sites group. The emergency reference and the dock-day rhythm,
 * which were rows here, are pages of their own (#1854); the dock day's
 * site-override read went with it. The one figure it shows, the boats still
 * missing a radio identity, the page reads and hands in.
 */
export function BoatsSitesGroup({
  view,
  boatsWithoutRadioIdentity,
}: {
  view: SettingsView;
  /** Live boats with neither a call sign nor an MMSI (review B1), named on the fleet's door. */
  boatsWithoutRadioIdentity: number;
}) {
  const { shop, shopSlug, t } = view;
  return (
    <SettingsGroup group={BOATS_SITES_GROUP} label={t(BOATS_SITES_GROUP.labelKey)}>
      <InsetGroup>
        {/* A shore-and-pool shop has no hulls to name, so the row is gone
            rather than empty — an empty control for a thing you do not own
            is a question you have to answer twice. Existing boat rows are
            left alone: turning the option back on brings the fleet back
            exactly as it was. */}
        {shop.hasBoatDiving ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/boats`}
            heading={t("boats.heading")}
            note={
              boatsWithoutRadioIdentity > 0
                ? t("boats.radioIdentityMissing", { count: boatsWithoutRadioIdentity })
                : undefined
            }
          />
        ) : null}

        {/* A reference library the daily surfaces consume — the board's add
          panel reads the dive-site list. It left the header nav with the
          cut to a five-section nav; an owner's path to it is this page (and the
          palette). */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/dive-sites`}
          heading={t("settings.main.diveSites.heading")}
        />

        <SettingsDoorRow
          href={`/shop/${shopSlug}/safety-checklist`}
          heading={t("settings.main.safetyChecklist.heading")}
        />

        {/* **Not gated on boat diving.** A shore operation's crew needs a chamber number exactly as much as a
            boat's does. Its own row rather than a line inside another
            because it is the one thing on this page a crew reads when
            something has gone wrong (issue #688). */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/emergency-reference`}
          heading={t("settings.main.emergency.heading")}
        />

        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/dock-day`}
          heading={t("settings.main.dockCall.heading")}
        />
      </InsetGroup>
    </SettingsGroup>
  );
}
