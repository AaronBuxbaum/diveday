import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { publicBoatLine } from "@/db/boat-line";
import { getDb } from "@/db/client";
import { requestTranslator } from "@/i18n/request";
import {
  BOAT_LINE_STAGE_KEYS,
  BOAT_LINE_STEP_KEYS,
  boatLineMarks,
  boatLineSteps,
  boatWordIsStale,
} from "@/lib/boat-line";
import { nowDate } from "@/lib/clock";
import { telHref } from "@/lib/contact-links";
import { formatShortDate, formatTime, formatTimeTz } from "@/lib/format";
import { googleMapsUrl } from "@/lib/maps";
import { shopMapQuery } from "@/lib/shop-address";
import { liveStageOf } from "@/lib/trip-stages";
import { uuidParam } from "@/lib/uuid";
import { BoatLine } from "./_components/BoatLine";

/**
 * **Follow the boat** — ADR 20260908-one-hand, decision 6, lever U.
 *
 * The third side of round 3's line. The desk reads it on the trip page and the
 * diver reads it on their thread; this is the page for the person on the dock,
 * the one who today rings the shop. It carries the boat, the day, the stage
 * word the crew tapped with the time they tapped it, and the departure's own
 * line. It carries **no** name, no count of people, no position, no map of the
 * water and no medical fact — none of which is filtered here, because none of
 * it is in the shape `publicBoatLine` returns.
 *
 * Two doors and no others: directions to the meeting point, and the shop's
 * number. Deliberately no booking door — a stranger holding this link came to
 * find out whether the boat is back, and selling to them on that page is the
 * cheapest thing this product could do.
 */
export const instant = true;

const QUIET_LINK_CLASS =
  "inline-flex min-h-11 shrink-0 items-center font-medium text-primary hover:underline";

/**
 * `noindex`, always, and not from the shop's search-listing choice.
 *
 * This is a link a diver hands to one person, about one morning. A shop that
 * said yes to Google said yes to its schedule and its courses; a page that is
 * only true for a few hours has no business in an index, and would still be in
 * one long after the boat tied up.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; tripId: string }>;
}): Promise<Metadata> {
  const { shopSlug, tripId } = await params;
  const id = uuidParam(tripId);
  const line = id
    ? await publicBoatLine(await getDb(), { shopSlug, tripId: id, now: nowDate() })
    : null;
  const robots = { index: false, follow: false };
  if (!line) return { title: "DiveDay", robots };
  return { title: `${line.trip.boatName ?? line.trip.title} — ${line.shop.name}`, robots };
}

export default async function FollowTheBoatPage({
  params,
}: {
  params: Promise<{ shopSlug: string; tripId: string }>;
}) {
  await connection();
  const { shopSlug, tripId } = await params;
  const id = uuidParam(tripId);
  if (!id) notFound();
  const now = nowDate();
  const line = await publicBoatLine(await getDb(), { shopSlug, tripId: id, now });
  // One `notFound()` for every refusal, the switch being off included. A page
  // that said "this shop does not share that" would still confirm the
  // departure exists, which is exactly what the shop declined to publish.
  if (!line) notFound();

  const { shop, trip } = line;
  const { locale, t } = await requestTranslator(shop.defaultLocale);

  // Whether the crew's last word still speaks at all is `liveStageOf`'s call —
  // the same one the storefront and the diver's thread make, so the three
  // surfaces cannot disagree about a stage nobody cleared. Whether this page
  // names the time it was said is `boatWordIsStale`'s.
  const word = line.word
    ? liveStageOf({ ...line.word, siteName: null, recordedByName: null }, trip.endsAt, now)
    : null;
  const steps = boatLineSteps({
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    rhythm: shop.rhythm,
    siteNames: line.siteNames,
    siteBottomTimes: line.siteBottomTimes,
    legTravelTimes: line.legTravelTimes,
    diveMode: shop.diveMode,
  });
  const marks = boatLineMarks(steps, word);

  // The site the one stage word that names a place is about, read off the plan
  // rather than off the tap: `trip_stage_events.dive_site_id` is a snapshot of
  // the plan's first site, and this page already has the plan in hand.
  const firstSite = line.siteNames.find((name) => name) ?? null;
  const stageWord = !word
    ? t("boatLine.atTheDock")
    : word.stage === "underway"
      ? firstSite
        ? t("boatLine.stage.underway", { site: firstSite })
        : t("boatLine.stage.underwayNoSite")
      : t(BOAT_LINE_STAGE_KEYS[word.stage]);
  // Under the word: what the crew said and when — or, with nothing said, the
  // one fact a boat still at the dock has, which is when it leaves. "As of"
  // once the word is a quarter of an hour old, and never a word about the
  // shop being late: a boat that is late is when this page is worth the most.
  const stale = word ? boatWordIsStale(word.recordedAt, now) : false;
  const said = word
    ? t(stale ? "boatLine.asOf" : "boatLine.said", {
        when: formatTimeTz(word.recordedAt, locale, shop.timezone),
      })
    : t("boatLine.leavesAt", { time: formatTimeTz(trip.startsAt, locale, shop.timezone) });

  const day = formatShortDate(trip.startsAt, locale, shop.timezone);
  const meetingLabel = trip.meetingPointLabel?.trim() || shop.name;
  const mapQuery =
    trip.meetingPointAddress?.trim() ||
    shopMapQuery(shop.name, {
      street: shop.addressStreet,
      locality: shop.addressLocality,
      region: shop.addressRegion,
      postalCode: shop.addressPostalCode,
      country: shop.addressCountry,
    });

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("tripStage.liveEyebrow")}
        title={trip.boatName ?? trip.title}
        titleFace="brand"
        meta={
          // The day, and the departure's own name beside it — but only where
          // the title above is the *hull's* name. A shop with no boat on file
          // has the departure's title as its title already, and repeating it
          // one line down is the same words twice on one screen.
          <p className="text-base text-muted">
            {trip.boatName ? t("boatLine.whenAndTrip", { date: day, trip: trip.title }) : day}
          </p>
        }
      />
      {/* The stage word, in the shop's own face and at the page's own volume.
          No pill and no wash: `home` is the one stage that ever takes a tone
          (src/lib/trip-stages.ts), and it takes it on a staff surface where a
          day is being closed — not on a page a stranger reads. */}
      <p className={`font-brand-display ${LEAD_TITLE_CLASS}`}>{stageWord}</p>
      {/* What the crew said and when, and nothing else. "Back by 8:30" used to
          sit here too, and it is the last row of the line two inches below —
          the same fact twice, one of which a reader has to reconcile. */}
      <p className="mt-1 text-sm text-muted tabular-nums">{said}</p>

      <BoatLine
        heading={t("boatLine.dayHeading")}
        steps={steps.map((step, index) => ({
          key: `${step.kind}-${step.number ?? index}`,
          time: formatTime(step.at, locale, shop.timezone),
          label:
            step.kind === "site"
              ? (step.siteName ?? t("boatLine.diveNumber", { number: step.number ?? index }))
              : t(BOAT_LINE_STEP_KEYS[step.kind]),
          mark: marks[index] ?? "todo",
        }))}
      />

      {/* The one sentence this page keeps. A reader who does not know what it
          cannot tell them reads a quiet line as bad news. */}
      <p className="mt-6 text-sm text-muted">{t("boatLine.note")}</p>

      <div className="mt-8 flex flex-col border-t border-border">
        <div className="flex min-h-13 items-center gap-3 border-b border-border">
          <span className="min-w-0 flex-1 text-base">{meetingLabel}</span>
          {mapQuery ? (
            <a
              href={googleMapsUrl(mapQuery)}
              target="_blank"
              rel="noopener"
              className={QUIET_LINK_CLASS}
            >
              {t("boatLine.directions")}
            </a>
          ) : null}
        </div>
        {shop.contactPhone ? (
          <div className="flex min-h-13 items-center gap-3 border-b border-border">
            <span className="min-w-0 flex-1 text-base">{t("boatLine.callShop")}</span>
            <a href={telHref(shop.contactPhone)} className={QUIET_LINK_CLASS}>
              {shop.contactPhone}
            </a>
          </div>
        ) : null}
      </div>
    </main>
  );
}
