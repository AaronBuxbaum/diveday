import Link from "next/link";
import { listFlySafeFollowUps } from "@/db/fly-safe-correction";
import { listTripUnitsToCheckIn } from "@/db/gear";
import { listTripIncidentReports } from "@/db/incident-reports";
import { shopPath } from "@/lib/staff-notices";
import { readManifestView } from "../../manifest/_components/manifest-view";
import { QUIET_ACTION } from "../trip-ink";
import { closeOutItems } from "../wrapped-close-out";
import type { PhaseRecordContext } from "./WaterPhase";
import { waterStandingOf } from "./water-reading";

/** The same recorded close-out items shown in Wrapped up, while looking back. */
export async function LookBackCloseOut({
  record,
  cancelled,
  notBack,
}: {
  record: PhaseRecordContext;
  cancelled: boolean;
  notBack: number;
}) {
  const { context, tripId, locale, t } = record;
  const { db, shop, session } = context;
  const [view, rentalsOut, incidents, flySafe] = await Promise.all([
    readManifestView({ ...context, shopSlug: shop.slug, tripId, locale, t }),
    cancelled ? [] : listTripUnitsToCheckIn(db, shop.id, tripId),
    listTripIncidentReports(db, shop.id, tripId, session.user.personId),
    listFlySafeFollowUps(db, { shopId: shop.id, tripId }),
  ]);
  const standing = view.status === "ready" ? waterStandingOf(view) : null;
  const items = closeOutItems({
    standing,
    rentalsOut,
    reports: incidents.reports,
    cancelled,
    flySafe,
  });
  const alerts = standing?.alerts ?? 0;
  const warning = notBack > 0 || alerts > 0;
  if (items.length === 0 && !warning) return null;
  return (
    <div>
      {alerts > 0 ? (
        <p className="font-semibold text-danger">
          {t("trips.clock.water.alerts", { count: alerts })}
        </p>
      ) : null}
      <Link href={`${shopPath(shop.slug, "trips", tripId)}?phase=wrapped`} className={QUIET_ACTION}>
        {items.length > 0 && standing !== null
          ? t("trips.clock.wrapped.lookBackOpen", { count: items.length })
          : t("trips.clock.wrapped.lookBackWarning")}
      </Link>
    </div>
  );
}
