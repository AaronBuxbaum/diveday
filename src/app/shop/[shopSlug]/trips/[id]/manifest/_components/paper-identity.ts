import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { formatPaperDateTime } from "../../_components/DeparturePaperIdentity";

export function manifestPaperIdentity(
  shop: { name: string; timezone: string },
  trip: { id: string; title: string; startsAt: Date },
  vessel: { name: string } | null,
  checkpoint: RollCallCheckpoint,
  locale: string,
  t: StaffTranslator,
) {
  const paperIdentity = [
    shop.name,
    trip.title,
    `${formatPaperDateTime(trip.startsAt, locale, shop.timezone)} · ${shop.timezone}`,
    [vessel?.name, t("trips.surfaces.manifest"), rollCallCheckpointText(t, checkpoint)]
      .filter(Boolean)
      .join(" · "),
  ];
  const printed = `${t("print.sheet.printed", { date: formatPaperDateTime(nowDate(), locale, shop.timezone) })} · ${shop.timezone}`;
  const pageName = `departure-${trip.id}-manifest-${checkpoint.replace(/[^a-z0-9-]/g, "-")}`;
  return { pageName, identity: paperIdentity, printed };
}
