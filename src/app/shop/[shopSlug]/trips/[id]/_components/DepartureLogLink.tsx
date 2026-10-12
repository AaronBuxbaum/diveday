import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { canPersonExportIncidentRecord } from "@/db/authz";
import { getDb } from "@/db/client";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/**
 * The departure log's door on the Details tab (ADR
 * 20260804-incident-export-owner-gate, amendment 2026-10-07). It reaches every
 * departure, live or back, which is what the 2026-08-12 amendment asks for; the
 * Today card is a briefing and no longer carries it.
 *
 * Owner-only and absent for everyone else: the gate is read against the
 * database here, so a demotion takes effect at once. The log route checks it
 * again, so this render is never the only gate.
 */
export async function DepartureLogLink({
  shop,
  personId,
  tripId,
}: {
  shop: { id: string; slug: string; defaultLocale: string };
  personId: string;
  tripId: string;
}) {
  if (!(await canPersonExportIncidentRecord(await getDb(), shop.id, personId))) return null;
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  return (
    <Link
      href={shopPath(shop.slug, "trips", tripId, "log")}
      className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
    >
      {t("incidentExport.openLink")}
    </Link>
  );
}
