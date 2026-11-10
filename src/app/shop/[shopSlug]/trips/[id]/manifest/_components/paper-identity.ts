import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { sheetAttribution } from "../../../../print/_components/ShopSheet";
import { formatPaperDateTime } from "../../_components/DeparturePaperIdentity";

export function manifestPaperIdentity(
  shop: { name: string; timezone: string },
  trip: { id: string; title: string; startsAt: Date },
  vessel: { name: string } | null,
  checkpoint: RollCallCheckpoint,
  locale: string,
  t: StaffTranslator,
  printedBy?: string | null,
) {
  const paperIdentity = [
    shop.name,
    trip.title,
    `${formatPaperDateTime(trip.startsAt, locale, shop.timezone)} · ${shop.timezone}`,
    [vessel?.name, t("trips.surfaces.manifest"), rollCallCheckpointText(t, checkpoint)]
      .filter(Boolean)
      .join(" · "),
  ];
  const printed = `${sheetAttribution(t, formatPaperDateTime(nowDate(), locale, shop.timezone), printedBy)} · ${shop.timezone}`;
  const pageName = `departure-${trip.id}-manifest-${checkpoint.replace(/[^a-z0-9-]/g, "-")}`;
  return { pageName, identity: paperIdentity, printed };
}
