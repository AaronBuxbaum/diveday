import { InsetGroup } from "@/components/ui/ledger";
import { BoatModeRow } from "../BoatModeRow";
import { SettingsDoorRow } from "../SettingsRows";
import { FEATURES_GROUP, SettingsGroup, type SettingsView } from "./kit";

/**
 * The Features group (issue #2814): one door to the page of every on/off
 * switch a shop owns. The switches were nine rows in six groups; a row is a
 * place where a value is set, and a switch is not one. Boat mode sits under
 * it: a switch about this device rather than the shop, saved as it is ticked.
 */
export function FeaturesGroup({ view }: { view: SettingsView }) {
  const { shopSlug, t } = view;
  return (
    <SettingsGroup group={FEATURES_GROUP} label={t(FEATURES_GROUP.labelKey)}>
      <InsetGroup>
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/features`}
          heading={t("settings.main.features.door")}
        />
        <BoatModeRow label={t("settings.main.boatMode")} />
      </InsetGroup>
    </SettingsGroup>
  );
}
