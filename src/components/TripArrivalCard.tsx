import { ArrivalMap } from "@/components/ArrivalMap";
import { ShopContactLinks } from "@/components/ShopContactLinks";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SectionCard } from "@/components/ui/card";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { dockCallAt } from "@/lib/dock-call";
import { formatTime } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { openMapsUrl, osmMapEmbedUrl } from "@/lib/maps";
import { meetingPointOf } from "@/lib/meeting-point";
import type { ShopAddressParts } from "@/lib/shop-address";

export type ArrivalCardShop = {
  name: string;
  slug: string;
  timezone: string;
  contactPhone: string | null;
  contactEmail: string | null;
  address: ShopAddressParts;
};

export type ArrivalCardTrip = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
  arrivalLandmark: string | null;
  arrivalParkingNote: string | null;
  arrivalTransitNote: string | null;
  arrivalLookFor: string | null;
  arrivalFirstInteraction: string | null;
  arrivalPhotoUrl: string | null;
};

function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** The arrival projection shared by the booked Ready view and saved card. */
export function arrivalCardFacts(shop: ArrivalCardShop, trip: ArrivalCardTrip) {
  // One reading of "where to go", shared with the mail and the printed pass
  // (`src/lib/meeting-point.ts`), so the page and what the diver carries agree.
  const point = meetingPointOf({
    shopName: shop.name,
    shopAddress: shop.address,
    meetingPointLabel: trip.meetingPointLabel,
    meetingPointAddress: trip.meetingPointAddress,
    arrivalLandmark: trip.arrivalLandmark,
    arrivalParkingNote: trip.arrivalParkingNote,
  });
  return {
    label: point.label,
    address: point.address,
    mapQuery: point.mapQuery,
    landmark: point.landmark,
    parkingNote: point.parking,
    transitNote: clean(trip.arrivalTransitNote),
    lookFor: clean(trip.arrivalLookFor),
    firstInteraction: clean(trip.arrivalFirstInteraction),
    photoUrl: clean(trip.arrivalPhotoUrl),
  };
}

export function arrivalDockCallLine(
  t: DiverTranslator,
  startsAt: Date,
  dockCallMinutes: number | null | undefined,
  locale: string,
  timeZone: string,
): string | null {
  if (dockCallMinutes == null) return null;
  const at = dockCallAt(startsAt, dockCallMinutes);
  if (!at) return null;
  return t("ready.dockCallLine", {
    time: formatTime(at, locale, timeZone),
    dock: t("notifications.common.dockCallMinutes", { minutes: dockCallMinutes }),
  });
}

function ArrivalFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold">{label}</dt>
      <dd className="mt-1 text-sm text-muted">{value}</dd>
    </div>
  );
}

/**
 * The Sites row's words. Consecutive dives at the same site are one run, so a
 * two-tank day on one reef reads "Molasses Reef, two dives" rather than the
 * site twice, which looked like a data error on the card a diver screenshots
 * (UX audit #14). Only *consecutive* repeats collapse: a day that goes A, B,
 * then back to A still reads in the order it runs.
 */
export function siteRunsLine(sites: readonly string[], locale: string, t: DiverTranslator): string {
  const runs: { site: string; dives: number }[] = [];
  for (const site of sites) {
    const last = runs.at(-1);
    if (last && last.site === site) last.dives += 1;
    else runs.push({ site, dives: 1 });
  }
  const [only] = runs;
  if (runs.length === 1 && only && only.dives > 1) {
    return t("trip.arrivalSiteRun", { site: only.site, count: only.dives });
  }
  return cachedListFormat(locale, { style: "long", type: "unit" }).format(
    runs.map(({ site, dives }) =>
      dives > 1 ? t("trip.arrivalSiteRunInList", { site, count: dives }) : site,
    ),
  );
}

/** One compact, booked-flow place-to-go card. No waiver or other capability state crosses in. */
export function TripArrivalCard({
  shop,
  trip,
  locale,
  sites,
  downloadHref,
  showMap = false,
}: {
  shop: ArrivalCardShop;
  trip: ArrivalCardTrip;
  locale: string;
  /**
   * Where this departure is planned to go, in the order the day runs them (ADR
   * 20260904-reef-all-the-way-down, Budget rule 5). The row renders nothing when the caller passes none — so the public trip
   * page and the downloadable card are untouched by its arrival.
   *
   * A shop-typed title need not name a site, and this is the only place the
   * order and the provenance appear together.
   */
  sites?: readonly string[];
  /** A post-booking download URL carrying the Ready capability. */
  downloadHref?: string | null;
  /**
   * Draw the meeting point on a map at the head of the card.
   *
   * Opt-in, because `src/lib/maps.ts` is deliberately URL-only and nothing in
   * it decides *whether* a caller should draw a map — and because this frame
   * is a third party's, which only a caller can say is acceptable on its
   * surface. The diver's thread passes it: this is the one map that page has,
   * and it used to sit in a trailing "Your dive shop" card that restated this
   * card's address, phone, email and map link a second time.
   *
   * It yields to the shop's own arrival photo below. Two 16:9 blocks stacked
   * is the card shouting, and a photo of the dock answers "did I find it?"
   * better than a street map does; a shop that uploaded none gets the map.
   */
  showMap?: boolean;
}) {
  const t = diverTranslator(locale);
  const facts = arrivalCardFacts(shop, trip);
  const hasDetails = Boolean(
    sites?.length ||
      facts.landmark ||
      facts.lookFor ||
      facts.parkingNote ||
      facts.transitNote ||
      facts.firstInteraction,
  );
  return (
    <SectionCard
      title={t("trip.arrivalHeading")}
      actions={
        downloadHref ? (
          <a
            href={downloadHref}
            download
            className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
          >
            {t("trip.saveArrivalCard")}
          </a>
        ) : undefined
      }
    >
      {facts.photoUrl ? (
        <StoredPhoto
          src={facts.photoUrl}
          alt={t("trip.arrivalImageAlt", { place: facts.label })}
          className="mb-5 aspect-[16/9] rounded-inset"
          sizes="(max-width: 640px) calc(100vw - 56px), 576px"
        />
      ) : showMap && facts.mapQuery ? (
        <ArrivalMap
          title={t("trip.arrivalMapTitle", { place: facts.label })}
          src={osmMapEmbedUrl(facts.mapQuery)}
        />
      ) : null}
      {/* A ruled row pads `pt-3` under its rule, the column's own gap above
          it, so each rule sits midway between the rows it divides. At `pt-4`
          the rows sat 4px low between their rules (pixel-craft K-480). */}
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-base font-semibold">{facts.label}</p>
          {facts.address ? (
            <address className="mt-1 text-sm text-muted not-italic">{facts.address}</address>
          ) : null}
          {facts.mapQuery ? (
            <a
              href={openMapsUrl(facts.mapQuery)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-11 items-center font-medium text-primary hover:underline"
            >
              {t("trip.openArrivalMap")}
            </a>
          ) : null}
        </div>
        {/* No date, time range or dock call here (fifth-loop ideas, item 23):
            the masthead above says when to be at the dock, and this card is
            only where. The saved card (`arrival-card/route.ts`) still carries
            the dock call, through `arrivalDockCallLine`, because it travels
            without the masthead. */}
        {hasDetails ? (
          <dl className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2">
            {sites && sites.length > 0 ? (
              <div>
                {/* The source in words, not a chip (visual review 2026-10-24,
                  B21): "Planned sites". A site change is ledgered (issue
                  #3060), so "What changed" says when the plan moved and who
                  moved it; the label says the list can move before then. */}
                <dt className="text-sm font-semibold">{t("trip.arrivalSites")}</dt>
                <dd className="mt-1 text-sm text-muted">{siteRunsLine(sites, locale, t)}</dd>
              </div>
            ) : null}
            {facts.landmark ? (
              <ArrivalFact label={t("trip.arrivalLandmark")} value={facts.landmark} />
            ) : null}
            {facts.lookFor ? (
              <ArrivalFact label={t("trip.arrivalLookFor")} value={facts.lookFor} />
            ) : null}
            {facts.parkingNote ? (
              <ArrivalFact label={t("trip.arrivalParking")} value={facts.parkingNote} />
            ) : null}
            {facts.transitNote ? (
              <ArrivalFact label={t("trip.arrivalTransit")} value={facts.transitNote} />
            ) : null}
            {facts.firstInteraction ? (
              <ArrivalFact
                label={t("trip.arrivalFirstInteraction")}
                value={facts.firstInteraction}
              />
            ) : null}
          </dl>
        ) : null}
        {/* The links are 44px targets on a 20px line, and here they hand the
            difference back (`-my-3`): their boxes made the line 44px tall, so
            "Need a hand?" sat 22px over them and 17px under the rule, grouped
            with the rule rather than with what it introduces, and the card's
            bottom inset grew from 20px to 32 (K-14 review, readiness@390).
            The boxes still take the tap; they overhang the line, not the
            card. */}
        {shop.contactPhone || shop.contactEmail ? (
          <p className="border-t border-border pt-3 text-sm text-muted">
            {t("trip.arrivalSupport")}{" "}
            <ShopContactLinks
              phone={shop.contactPhone}
              email={shop.contactEmail}
              className="-my-3"
            />
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}
