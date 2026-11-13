import { randomUUID } from "node:crypto";
import { signRosterConfirmation } from "@/features/offline-manifest-snapshots";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { ManifestRosterFreshness } from "./ManifestRosterFreshness";

/** Bind this particular server-rendered roster to its live-session check. */
export function RosterFreshness({
  tripId,
  shopId,
  sessionId,
  erasureEpoch,
  rosterRead,
  t,
}: {
  tripId: string;
  shopId: string;
  sessionId?: string;
  erasureEpoch: number;
  rosterRead?: string;
  t: StaffTranslator;
}) {
  const renderId = randomUUID();
  const renderProof =
    rosterRead && sessionId
      ? (signRosterConfirmation({
          shopId,
          tripId,
          sessionId,
          nonce: rosterRead,
          renderId,
          erasureEpoch,
        }) ?? undefined)
      : undefined;
  return (
    <ManifestRosterFreshness
      tripId={tripId}
      renderId={renderId}
      renderToken={rosterRead}
      renderProof={renderProof}
      copy={{
        confirmed: t("manifest.rosterConfirmed"),
        unconfirmed: t("manifest.rosterUnconfirmed"),
      }}
    />
  );
}
