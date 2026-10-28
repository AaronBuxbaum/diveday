import { submitInquiryAction } from "@/app/actions/inquiry";
import { DateRequestForm } from "@/components/DateRequestForm";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { RunningPublicSeries } from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { dateRequestCopy } from "@/i18n/date-request-copy";
import type { DiverTranslator } from "@/i18n/messages";
import { compareMonths, type MonthRef } from "@/lib/calendar";
import { runCadenceWords } from "./run-cadence";

/**
 * Whether the viewed month is at or past the end of what the board holds, so
 * the open-ended runs say they keep going. Any month from the last one with a
 * date on it onwards (review 3a, 2026-10-12): a reader who jumps past the
 * horizon is the one most owed the sentence. The default, uncursored view says
 * it only once its own list has nothing further to page to.
 */
export function viewsBoardsEnd(
  viewed: MonthRef,
  lastTripMonth: MonthRef | null,
  /** A month the reader chose, or a default view with nothing further to page to. */
  settled: boolean,
): boolean {
  if (lastTripMonth === null || compareMonths(viewed, lastTripMonth) < 0) return false;
  return settled;
}

/**
 * "Saturday Reef runs every Saturday." One sentence per run, in the run's own
 * cadence and the reader's weekday names.
 */
export function seriesHorizonLines(
  t: DiverTranslator,
  locale: string,
  runs: readonly RunningPublicSeries[],
): string[] {
  return runs.map((run) => {
    const cadence = runCadenceWords(t, locale, run);
    return t("schedule.horizon.runs", { title: run.title, cadence });
  });
}

/**
 * **The ask, promoted** (N-45), and **the board's end** (UX review
 * 2026-10-11, item 11).
 *
 * On a quiet board the date request is the page's one primary and its whole
 * job, so it stands as its own section with the form already open rather than
 * as the first collapsed row of "More ways": a shop between seasons cannot
 * afford its one available conversion to be behind a chevron.
 *
 * On the last month the horizon has materialized, the month rail runs out
 * although a series keeps going. The runs say so in their own cadence, and the
 * same open form stands under them for the diver planning further out. A shop
 * that switched date requests off (ADR 20261005-optional-shop-features) keeps
 * the sentences without the form.
 *
 * Either way it is the same component, the same action and the same
 * `#request-a-date` anchor as the collapsed row, which the page stands down
 * whenever this renders a form, so the id is never rendered twice. Its own
 * provider, matching the course page's exactly: this form is the only Client
 * Component in it, and `inquiry` is the only namespace it reads.
 */
export function PromotedDateAsk({
  t,
  shopSlug,
  locale,
  timeZone,
  quiet,
  dateRequestsEnabled,
  runningLines,
  className,
}: {
  t: DiverTranslator;
  shopSlug: string;
  locale: string;
  timeZone: string;
  /** The off-season card is up (`src/lib/off-season.ts`). */
  quiet: boolean;
  dateRequestsEnabled: boolean;
  /** {@link seriesHorizonLines}, from the board's last month on ({@link viewsBoardsEnd}); else empty. */
  runningLines: readonly string[];
  className: string;
}) {
  const atHorizon = runningLines.length > 0;
  if (!dateRequestsEnabled || (!quiet && !atHorizon)) {
    if (!atHorizon) return null;
    return (
      <section aria-labelledby="horizon-heading" className={className}>
        <h2 id="horizon-heading" className="sr-only">
          {t("schedule.horizon.heading")}
        </h2>
        <p className="max-w-prose text-muted text-pretty">
          {[...runningLines, t("schedule.horizon.later")].join(" ")}
        </p>
      </section>
    );
  }
  const copy = dateRequestCopy(t, "dive");
  return (
    <DiverIntlProvider locale={locale} timeZone={timeZone} namespaces={["inquiry"]}>
      <DateRequestForm
        submitRequest={submitInquiryAction.bind(null, shopSlug, null)}
        askInterest
        sectionId="request-a-date"
        className={`${className ?? ""} print:hidden`}
        headingClassName={`font-brand-display ${SECTION_TITLE_CLASS}`}
        contactEmail={null}
        contactPhone={null}
        copy={
          quiet
            ? { ...copy, heading: t("schedule.offSeason.requestHeading") }
            : {
                ...copy,
                heading: t("schedule.horizon.requestHeading"),
                intro: [...runningLines, t("schedule.horizon.later")].join(" "),
              }
        }
      />
    </DiverIntlProvider>
  );
}
