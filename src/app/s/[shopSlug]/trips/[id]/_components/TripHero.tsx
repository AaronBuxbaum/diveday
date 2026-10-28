import { StoredPhoto } from "@/components/StoredPhoto";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { getBoatById } from "@/db/boats";
import type { AppDb } from "@/db/client";
import type { PublicRun } from "@/db/series-next";
import type { DiverTranslator } from "@/i18n/messages";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import type { MinimumSeatsState } from "@/lib/minimum-seats";
import { publicTripCalendarPath } from "@/lib/public-routes";
import { runCadenceWords } from "../../../_components/run-cadence";
import { TripActions } from "./TripActions";
import { TripHeader } from "./TripHeader";

type HeaderProps = Parameters<typeof TripHeader>[0];

/**
 * **The departure's hero**: its header, the two conveniences inside it, the
 * day's cover photo, and the only two notes that stand above the reading — the
 * conditions hold and the head count the departure needs. The left column's
 * first cell from `lg`. Everything here is decided by the page; this only
 * lays it out (`page.composition.test.ts` reads it by name).
 */
export function TripHero({
  shop,
  trip,
  meetingDays,
  locale,
  isEmbed,
  shopSlug,
  coverPhoto,
  minimumSeats,
  run = null,
  t,
}: {
  shop: HeaderProps["shop"] & { timezone: string };
  trip: HeaderProps["trip"] & { id: string; conditionsHold: boolean };
  meetingDays: HeaderProps["meetingDays"];
  locale: string;
  isEmbed: boolean;
  shopSlug: string;
  coverPhoto: string | null;
  minimumSeats: MinimumSeatsState;
  /** The run this departure is one of (fourth review, item 35), or null. */
  run?: PublicRun | null;
  t: DiverTranslator;
}) {
  const tripId = trip.id;
  // "Runs every Saturday · next Sat, Oct 24": said only while a next date sells.
  const runLine = run?.next
    ? t("trip.runLine", {
        cadence: runCadenceWords(t, locale, run),
        date: formatShortDate(run.next, locale, shop.timezone),
      })
    : null;
  return (
    <div>
      {/* No standalone "← All trips" link: the header's own eyebrow is the
              way up outside the frame (2026-08-28 diver-views review, finding
              8 — see TripHeader). */}
      <TripHeader
        shop={shop}
        trip={trip}
        meetingDays={meetingDays}
        locale={locale}
        embed={isEmbed}
        showMeetingPoint={false}
        runLine={runLine}
      />
      {/* The hero's two conveniences, inside the hero rather than as a row of
              buttons under it. */}
      {isEmbed ? null : <TripActions calendarUrl={publicTripCalendarPath(shopSlug, tripId)} />}
      {/* The place, before the words about it: the day's first site
              photo (`dayCoverPhoto`). Decorative, as the site page's own
              cover is — the title and "The day" name the place. Not inside
              an embed, where the frame is a list-first window. */}
      {coverPhoto && !isEmbed ? (
        <StoredPhoto
          src={coverPhoto}
          alt=""
          className="mt-6 aspect-[3/2] w-full rounded-panel print:hidden"
          sizes="(min-width: 640px) 33rem, 92vw"
          priority
        />
      ) : null}
      {/* The one warning panel this page ever wears — the same radius,
              border and tone as the conditions-changed panel below, on purpose.
              Two amber boxes with different radii and border weights read as two
              different systems warning about one weather call. Each is a card in
              a tone on its neighbour's inset. A hold replaces the booking form
              with plain type, so this banner never stands beside the form's
              card: the box beside it is the minimum-seats note directly under
              it, 16px in, so it takes the default tone panel (`TONE_PANEL_CLASS`),
              level with that note on a phone. */}
      {trip.conditionsHold ? (
        <div role="status" className={`mt-5 ${TONE_PANEL_CLASS} border-warning/40 bg-warning/10`}>
          <h2 className="font-semibold">{t("trip.conditionsHoldHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{t("trip.conditionsHoldBody")}</p>
        </div>
      ) : null}
      {/* The promise, stated before anyone pays: what this departure needs to
              run, and the exact moment the answer arrives. It is what makes the
              automatic cancellation fair rather than abrupt — a diver who books
              a boat that needs four people knows that, and knows when they'll
              hear (ADR 20260813-minimum-head-count-departures). Dropped once the
              count is met, because then there is nothing conditional left to
              say, and on a departure that already sailed or was cancelled. */}
      {minimumSeats.kind === "short" || minimumSeats.kind === "due" ? (
        // Sunken fill, no border: a stated fact about the departure, not a
        // warning — it wears the same quiet material as the supporting
        // reading, one step below the amber conditions banner above.
        <p className="mt-5 rounded-inset bg-surface-sunken p-4 text-sm text-muted">
          {t("trip.minimumSeatsNotice", {
            minimum: minimumSeats.minimum,
            deadline: formatDateTimeTz(minimumSeats.decidesAt, locale, shop.timezone),
          })}
        </p>
      ) : null}
    </div>
  );
}

export async function TripBoatPhoto({
  db,
  shopId,
  boatId,
  t,
}: {
  db: AppDb;
  shopId: string;
  boatId: string | null;
  t: DiverTranslator;
}) {
  const boat = boatId ? await getBoatById(db, shopId, boatId) : null;
  if (!boat?.photoUrl) return null;
  return (
    <figure className="flex items-center gap-4">
      <StoredPhoto
        src={boat.photoUrl}
        alt={boat.name}
        className="size-24 shrink-0 rounded-lg"
        sizes="96px"
      />
      <figcaption>
        <p className="text-sm text-muted">{t("trip.boatLabel")}</p>
        <p className="font-medium">{boat.name}</p>
      </figcaption>
    </figure>
  );
}
