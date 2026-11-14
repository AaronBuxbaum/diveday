import {
  signRosterConfirmation,
  signRosterHistoryScope,
} from "@/features/offline-manifest-snapshots";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { ManifestRosterFreshness } from "./ManifestRosterFreshness";

/** Bind this particular server-rendered roster to its live-session check. */
export function RosterFreshness({
  tripId,
  shop,
  sessionId,
  read,
  locale,
  rosterRead,
  renderId,
  checkpoint,
  t,
}: {
  tripId: string;
  shop: { id: string; timezone: string };
  sessionId?: string;
  read: { renderErasureEpoch: number; readCompletedAt: number };
  locale: string;
  rosterRead?: string;
  renderId: string;
  checkpoint: string;
  t: StaffTranslator;
}) {
  const { readCompletedAt, renderErasureEpoch } = read;
  const historyScope = sessionId
    ? (signRosterHistoryScope({ shopId: shop.id, tripId, sessionId, checkpoint }) ?? "")
    : "";
  const renderProof =
    rosterRead && sessionId
      ? (signRosterConfirmation({
          shopId: shop.id,
          tripId,
          sessionId,
          nonce: rosterRead,
          renderId,
          erasureEpoch: renderErasureEpoch,
          checkpoint,
          readCompletedAt,
        }) ?? undefined)
      : undefined;
  return (
    <ManifestRosterFreshness
      tripId={tripId}
      renderId={renderId}
      renderToken={rosterRead}
      renderProof={renderProof}
      checkpoint={checkpoint}
      historyScope={historyScope}
      readCompletedAt={readCompletedAt}
      readCompletedLabel={t("manifest.rosterReadCompletedAt", {
        date: formatDateTimeTz(new Date(readCompletedAt), locale, shop.timezone),
      })}
      requireCommit
      copy={{
        confirmed: t("manifest.rosterConfirmed"),
        unconfirmed: t("manifest.rosterUnconfirmed"),
      }}
    />
  );
}
