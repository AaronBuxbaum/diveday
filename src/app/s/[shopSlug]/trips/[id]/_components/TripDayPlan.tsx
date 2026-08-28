import { Fragment } from "react";
import { GroupLabel, LedgerRow } from "@/components/ui/ledger";
import { diverTranslator } from "@/i18n/messages";
import type { DiveBriefing } from "./types";

/**
 * **"The day" and "Look for" — the pitch, in two ledger beats.**
 *
 * ADR 20260827-the-divers-thread, decision 2: the content that answers "is this
 * my day?" leads, and the form closes. The same facts used to arrive *below*
 * the booking form as `DiveBriefingsSection` — an eyebrow, a `text-2xl`
 * heading as loud as the page's own `h1`, a swipeable deck of photo cards and a
 * comparison table — roughly a thousand pixels of reading placed where only a
 * diver who had already paid would ever reach it. Slice 7c then took the deck
 * off `/ready` too and deleted it (H-49), so these two beats are the whole of
 * what the product says about what a day dives.
 *
 * What survives here is what a deciding diver actually needs: the run of dives
 * in plan order, and the species the shop has put on those sites' field guides.
 * Time-neutral on purpose — a dive plan's clock belongs to the day itself
 * (`PackingSection`'s dock-day rhythm on the thread), and a schedule printed
 * beside a Book button reads as a commitment the crew has not made.
 */
export function TripDayPlan({
  briefings,
  locale,
}: {
  briefings: DiveBriefing[];
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
}) {
  if (briefings.length === 0) return null;
  const t = diverTranslator(locale);
  return (
    <section className="mt-8">
      <GroupLabel as="h2">{t("trip.theDay")}</GroupLabel>
      <ul className="mt-2">
        {briefings.map(({ dive, diveSite }) => (
          <LedgerRow
            key={dive.id}
            kind={{ word: t("trip.diveNumber", { number: dive.diveNumber }), tone: "neutral" }}
            trailing={
              diveSite?.depthRange ? (
                <span className="text-sm text-muted tabular-nums">{diveSite.depthRange}</span>
              ) : null
            }
          >
            <span className="block text-sm font-medium">
              {dive.title ?? diveSite?.name ?? t("trip.siteToBeConfirmed")}
            </span>
            {/* The site under the dive's own name, when the shop gave the dive
                a name of its own that is not simply the site's. A departure
                whose second tank has no site yet says so here rather than
                reading as a one-site day. */}
            {dive.title && diveSite?.name && dive.title !== diveSite.name ? (
              <span className="block text-sm text-muted">{diveSite.name}</span>
            ) : null}
            {dive.title && !diveSite ? (
              <span className="block text-sm text-muted">{t("trip.siteToBeConfirmed")}</span>
            ) : null}
          </LedgerRow>
        ))}
      </ul>
    </section>
  );
}

/**
 * The species the shop chose for this day's sites, as one line of names.
 *
 * DiveDay writes the words and the shop picks the faces (ADR
 * 20260813-marine-life-is-diveday-copy), so these arrive already resolved into
 * the reader's language by `fieldGuideCards`. Deduplicated by name because a
 * two-tank day on one mooring carries the same guide twice, and renders nothing
 * at all when no site names a species — an empty "Look for" is a heading
 * apologising for having nothing under it.
 */
export function TripLookFor({ briefings, locale }: { briefings: DiveBriefing[]; locale: string }) {
  const t = diverTranslator(locale);
  const names = [
    ...new Set(briefings.flatMap(({ creatures }) => creatures.map((creature) => creature.name))),
  ];
  if (names.length === 0) return null;
  return (
    <section className="mt-6">
      <GroupLabel as="h2">{t("trip.lookFor")}</GroupLabel>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
        {names.map((name, index) => (
          <Fragment key={name}>
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span>{name}</span>
          </Fragment>
        ))}
      </p>
    </section>
  );
}
