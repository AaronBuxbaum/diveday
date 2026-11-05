import { groupLabelClass } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import type { OfflineManifestPayload } from "@/lib/offline-manifests";

/**
 * **The deck count, as saved and read-only** (issue #3897): what the captain
 * counted at this checkpoint when the copy was made. Nothing here records a
 * count, and nothing reads it against the marks: the saved marks may have
 * moved since, so the live page owns the verdict. Renders nothing for a
 * checkpoint nobody counted at, or a copy saved before the field existed.
 */
export function OfflineDeckCount({
  counts,
  checkpoint,
  timeZone,
  locale,
  t,
}: {
  counts: OfflineManifestPayload["deckCounts"];
  checkpoint: string;
  timeZone: string;
  locale: string | undefined;
  t: StaffTranslator;
}) {
  const record = counts?.find((entry) => entry.checkpoint === checkpoint);
  if (!record) return null;
  return (
    <section aria-label={t("manifest.deckCount.heading")} className="mt-4">
      <h2 className={groupLabelClass()}>{t("manifest.deckCount.heading")}</h2>
      <p className="mt-2 text-base tabular-nums">
        {t("manifest.deckCount.savedLine", {
          counted: record.counted,
          time: formatTime(new Date(record.recordedAt), locale, timeZone),
          name: record.recordedByName,
        })}
      </p>
    </section>
  );
}
