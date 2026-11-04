import type { DeckCountRecord } from "@/db/deck-counts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { readDeckCount } from "@/lib/deck-count";
import { formatTime } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
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
  const reading = readDeckCount({ counted: record.counted, ...facts });
  const lines = [
    reading.agrees
      ? t("manifest.deckCount.agrees", { counted: reading.counted })
      : t("manifest.deckCount.differs", {
          counted: reading.counted,
          expected: reading.expected,
        }),
  ];
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
      recordedLine: t("manifest.deckCount.recordedLine", {
        name: record.recordedByName,
        time: formatTime(record.recordedAt, locale, timeZone),
      }),
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
