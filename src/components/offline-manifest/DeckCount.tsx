import { groupLabelClass } from "@/components/ui/group-label";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { nowDate } from "@/lib/clock";
import { deckCountWhen } from "@/lib/deck-count";
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
  t: OfflineManifestTranslator;
}) {
  const record = counts?.find((entry) => entry.checkpoint === checkpoint);
  if (!record) return null;
  return (
    <section aria-label={t("manifest.deckCount.heading")} className="mt-4">
      <h2 className={groupLabelClass()}>{t("manifest.deckCount.heading")}</h2>
      <p className="mt-2 text-base tabular-nums">
        {t(record.stale ? "manifest.deckCount.savedStale" : "manifest.deckCount.savedLine", {
          counted: record.counted,
          time: deckCountWhen(new Date(record.recordedAt), nowDate(), locale, timeZone),
          name: record.recordedByName,
        })}
      </p>
    </section>
  );
}
