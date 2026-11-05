import type { DeckCountRecord } from "@/db/deck-counts";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { isDeckCountStale, readDeckCount } from "@/lib/deck-count";
import { formatTime } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import type { RollCallCheckpoint } from "@/lib/roll-call";
import type { DeckCountCopy } from "./DeckCount";
import type { deckCountFacts } from "./head-count-view";

/** How many people with no mark the reading names before it counts the rest. */
const NAMED_UNMARKED = 5;

/**
 * **The deck count's words** (loop 5, row 1): the form's labels, and the
 * reading once a count stands at this checkpoint. Agree, or name the gap:
 * "You count 11. The manifest says 12." then who has no mark, then, when the
 * marks run ahead of the deck, that a mark may be on the wrong person. It
 * informs and never gates, so nothing here asks anything of the roll call.
 */
export function deckCountView({
  t,
  locale,
  timeZone,
  record,
  facts,
}: {
  t: StaffTranslator;
  locale: string;
  timeZone: string;
  /** The newest count at this checkpoint, or null when nobody counted. */
  record: DeckCountRecord | null;
  facts: ReturnType<typeof deckCountFacts>;
}): DeckCountCopy {
  const copy = {
    heading: t("manifest.deckCount.heading"),
    label: t("manifest.deckCount.label"),
    hint: t("manifest.deckCount.hint"),
    submit: t("manifest.deckCount.submit"),
    refusal: t("manifest.deckCount.refusal"),
  };
  if (!record) return copy;
  const recordedLine = t("manifest.deckCount.recordedLine", {
    name: record.recordedByName,
    time: formatTime(record.recordedAt, locale, timeZone),
  });
  // Marks moved after the captain counted: ask again, never a verdict (M2).
  if (isDeckCountStale(record.recordedAt, facts.latestMarkAt)) {
    return {
      ...copy,
      reading: {
        tone: "stale",
        lines: [
          t("manifest.deckCount.stale", {
            counted: record.counted,
            time: formatTime(record.recordedAt, locale, timeZone),
          }),
        ],
        recordedLine,
      },
    };
  }
  const reading = readDeckCount({ counted: record.counted, ...facts });
  const lines = [
    reading.agrees
      ? t("manifest.deckCount.agrees", { counted: reading.counted })
      : t("manifest.deckCount.differs", {
          counted: reading.counted,
          expected: reading.expected,
        }),
  ];
  if (reading.notBackAboard.length > 0) {
    lines.push(
      t("manifest.deckCount.notBack", { names: namesOf(t, locale, reading.notBackAboard) }),
    );
  }
  if (reading.unmarked.length > 0) {
    lines.push(t("manifest.deckCount.unmarked", { names: namesOf(t, locale, reading.unmarked) }));
  }
  if (reading.marksExceedCount) {
    lines.push(t("manifest.deckCount.marksAhead", { count: reading.markedAboard }));
  }
  return {
    ...copy,
    reading: {
      tone: reading.agrees ? "agrees" : "differs",
      lines,
      recordedLine,
    },
  };
}

function namesOf(t: StaffTranslator, locale: string, names: readonly string[]): string {
  if (names.length <= NAMED_UNMARKED) {
    return cachedListFormat(locale, { type: "conjunction" }).format(names);
  }
  return t("manifest.deckCount.unmarkedMore", {
    names: cachedListFormat(locale, { type: "unit", style: "short" }).format(
      names.slice(0, NAMED_UNMARKED),
    ),
    count: names.length - NAMED_UNMARKED,
  });
}

/**
 * **The deck count on paper**: one line per checkpoint, the dock and each
 * planned dive, because a crew with no signal writes the count by hand. A
 * checkpoint nobody counted at is a blank to fill in; one with a count wears
 * the newest, as the screen does. A count is never carried to another
 * checkpoint, and a count of zero is a count, not a blank.
 */
export function printedDeckCountLines({
  t,
  locale,
  timeZone,
  checkpoints,
  records,
}: {
  t: StaffTranslator;
  locale: string;
  timeZone: string;
  checkpoints: readonly RollCallCheckpoint[];
  records: ReadonlyMap<string, DeckCountRecord>;
}): { heading: string; lines: { checkpoint: RollCallCheckpoint; text: string }[] } {
  return {
    heading: t("manifest.deckCount.heading"),
    lines: checkpoints.map((checkpoint) => {
      const checkpointName = rollCallCheckpointText(t, checkpoint);
      const record = records.get(checkpoint);
      return {
        checkpoint,
        text: record
          ? t("manifest.deckCount.printedRecorded", {
              checkpoint: checkpointName,
              counted: record.counted,
              time: formatTime(record.recordedAt, locale, timeZone),
              name: record.recordedByName,
            })
          : t("manifest.deckCount.printedBlank", { checkpoint: checkpointName }),
      };
    }),
  };
}

/**
 * **The newest count at each checkpoint, as the saved copy carries it**
 * (`OfflineManifestPayload.deckCounts`): read-only there, so only what a
 * reader needs, with the time as an ISO string.
 */
export function offlineDeckCounts(
  records: ReadonlyMap<string, DeckCountRecord>,
): { checkpoint: string; counted: number; recordedAt: string; recordedByName: string }[] {
  return [...records].map(([checkpoint, record]) => ({
    checkpoint,
    counted: record.counted,
    recordedAt: record.recordedAt.toISOString(),
    recordedByName: record.recordedByName,
  }));
}
