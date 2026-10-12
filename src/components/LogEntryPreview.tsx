import { SiteMark } from "@/components/illustration/SiteMark";
import type { DiverTranslator } from "@/i18n/messages";
import { siteMarkFor } from "@/lib/site-mark";

/**
 * **"After the dive, your log entry is waiting"**, and a small picture of it
 * (UX review 2026-10-10, item 35).
 *
 * The recap's log entry, the card a diver saves as an image or prints into a
 * paper logbook, is the best thing the diver side of the app makes, and
 * nothing pointed at it: not the public trip page that sells the day, not the
 * `/ready` page a diver keeps all week. This is the one line that does, with a
 * miniature of the card in the recap's own shape (the lagoon band with the
 * site's drawing and the shop's display face, then the facts as a ruled list)
 * so the sentence has something to point at.
 *
 * **A preview, not the card.** The recap's `DiveRecord` carries the diver's
 * name, the crew, the conditions and a canvas export, none of which exist
 * before the dive; reusing it here would mean faking them. This draws only
 * what is already true: the date and the planned sites. The miniature is
 * decoration under a sentence that says everything (`aria-hidden`), so a
 * screen reader hears the line once and no list of facts it already has.
 */
export function LogEntryPreview({
  line,
  date,
  siteNames,
  isCourse = false,
  shopName,
  t,
}: {
  /** The sentence that points at the card, already in the reader's language. */
  line: string;
  /** The departure's date, already formatted in the shop's zone. */
  date: string;
  /** The day's planned sites, in plan order. */
  siteNames: string[];
  isCourse?: boolean;
  shopName: string;
  t: DiverTranslator;
}) {
  return (
    <section>
      <p className="text-base">{line}</p>
      <div
        aria-hidden="true"
        data-testid="log-entry-preview"
        className="mt-3 max-w-xs overflow-hidden rounded-panel border border-border bg-surface"
      >
        <div className="flex items-center gap-3 bg-primary-tint px-4 py-3">
          <SiteMark
            mark={siteMarkFor({ siteName: siteNames[0] ?? null, isCourse })}
            size="sm"
            ground="surface"
          />
          <span className="font-brand-display text-base font-semibold">
            {t("recap.logbookHeading")}
          </span>
        </div>
        <dl className="divide-y divide-border px-4 text-sm">
          <div className="flex gap-3 py-2">
            <dt className="w-14 shrink-0 text-xs font-medium text-muted">{t("recap.dateLabel")}</dt>
            <dd className="min-w-0">{date}</dd>
          </div>
          {siteNames.length > 0 ? (
            <div className="flex gap-3 py-2">
              <dt className="w-14 shrink-0 text-xs font-medium text-muted">
                {t("recap.sitesLabel")}
              </dt>
              <dd className="min-w-0 font-medium">{siteNames.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
        <p className="px-4 pb-3 text-xs text-muted">{t("recap.recordedBy", { shopName })}</p>
      </div>
    </section>
  );
}
