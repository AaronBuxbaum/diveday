import { SiteMark } from "@/components/illustration/SiteMark";
import type { DiverTranslator } from "@/i18n/messages";
import { siteMarkFor } from "@/lib/site-mark";

/**
 * **"After you dive, your log entry is waiting"**, and a small picture of it
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
 * what is already true: the date and the planned sites. It carries no
 * "Recorded by" line: nobody has recorded anything yet, and the shop's
 * signature belongs on the real card once the crew has. The miniature is
 * decoration under a sentence that says everything (`aria-hidden`), so a
 * screen reader hears the line once and no list of facts it already has.
 */
export function LogEntryPreview({
  line,
  date,
  siteNames,
  isCourse = false,
  fill = false,
  t,
}: {
  /** The sentence that points at the card, already in the reader's language. */
  line: string;
  /** The departure's date, already formatted in the shop's zone. */
  date: string;
  /** The day's planned sites, in plan order; a repeat is named once. */
  siteNames: string[];
  isCourse?: boolean;
  /**
   * Take the full width of the column, as on the `/ready` thread, where every
   * other card does (visual review 2026-10-24, B30). The trip page keeps the
   * small miniature beside its pitch.
   */
  fill?: boolean;
  t: DiverTranslator;
}) {
  // A two-tank on one site plans the site twice; the card names it once
  // ("Molasses Reef, Molasses Reef", third UX review, item 29).
  const sites = [...new Set(siteNames)];
  return (
    <section>
      <p className="text-base">{line}</p>
      <div
        aria-hidden="true"
        data-testid="log-entry-preview"
        className={`mt-3 ${fill ? "w-full" : "max-w-xs"} overflow-hidden rounded-panel border border-border bg-surface`}
      >
        <div className="flex items-center gap-3 bg-primary-tint px-4 py-3">
          <SiteMark
            mark={siteMarkFor({ siteName: sites[0] ?? null, isCourse })}
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
          {sites.length > 0 ? (
            <div className="flex gap-3 py-2">
              <dt className="w-14 shrink-0 text-xs font-medium text-muted">
                {t("recap.sitesLabel")}
              </dt>
              <dd className="min-w-0 font-medium">{sites.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}
