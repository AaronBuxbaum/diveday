import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** The live desk says when a dropped signal leaves its list stale. */
export function TripDeskConnectivity({ active, t }: { active: boolean; t: StaffTranslator }) {
  return active ? (
    <ConnectivityStatus
      offlineLabel={t("checkIn.offlineLabel")}
      onlyWhenOffline
      className="mt-2"
      copy={{
        online: t("shared.connectivity.online"),
        onlineTitle: t("shared.connectivity.onlineTitle"),
        offlineTitle: t("shared.connectivity.offlineTitle"),
      }}
    />
  ) : null;
}
