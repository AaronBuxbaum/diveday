import { ShopContactLinks } from "@/components/ShopContactLinks";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SectionCard } from "@/components/ui/card";
import { FactSource } from "@/components/ui/FactSource";
import { DIVER_FACT_SOURCE_KEYS } from "@/i18n/fact-source-labels";
import { diverTranslator } from "@/i18n/messages";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { googleMapsUrl } from "@/lib/maps";
import { type ShopAddressParts, shopAddressLines, shopMapQuery } from "@/lib/shop-address";

export type ArrivalCardShop = {
  name: string;
  slug: string;
  timezone: string;
  contactPhone: string | null;
  contactEmail: string | null;
  address: ShopAddressParts;
  /**
   * The shop's standing sentence about what happens at the dock (issue
   * #1212), in the shop's own words. Used only where the departure wrote none
   * of its own: two answers to one question is the defect.
   */
  dockCallNote: string | null;
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
  const shopLines = shopAddressLines(shop.address);
  const customLabel = clean(trip.meetingPointLabel);
  const customAddress = clean(trip.meetingPointAddress);
  const label = customLabel ?? shop.name;
  const address = customAddress ?? (shopLines.length > 0 ? shopLines.join(", ") : null);
  const mapQuery = customAddress
    ? [label, customAddress].filter(Boolean).join(", ")
    : customLabel
      ? address
        ? [label, address].join(", ")
        : null
      : shopMapQuery(shop.name, shop.address);
  return {
    label,
    address,
    mapQuery,
    landmark: clean(trip.arrivalLandmark),
    parkingNote: clean(trip.arrivalParkingNote),
    transitNote: clean(trip.arrivalTransitNote),
    lookFor: clean(trip.arrivalLookFor),
    firstInteraction: clean(trip.arrivalFirstInteraction) ?? clean(shop.dockCallNote),
    photoUrl: clean(trip.arrivalPhotoUrl),
  };
}

function ArrivalFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold">{label}</dt>
      <dd className="mt-1 text-sm text-muted">{value}</dd>
    </div>
  );
}

/** One compact, booked-flow place-to-go card. No waiver or other capability state crosses in. */
export function TripArrivalCard({
  shop,
  trip,
  locale,
  sites,
  downloadHref,
  className = "",
}: {
  shop: ArrivalCardShop;
  trip: ArrivalCardTrip;
  locale: string;
  /**
   * Where this departure is planned to go, in the order the day runs them (ADR
   * 20260904-reef-all-the-way-down, Budget rule 5). The row carries the Plan
   * chip and renders nothing when the caller passes none — so the public trip
   * page and the downloadable card are untouched by its arrival.
   *
   * A shop-typed title need not name a site, and this is the only place the
   * order and the provenance appear together.
   */
  sites?: readonly string[];
  /** A post-booking download URL carrying the Ready capability. */
  downloadHref?: string | null;
  className?: string;
}) {
  const t = diverTranslator(locale);
  const facts = arrivalCardFacts(shop, trip);
  return (
    <SectionCard
      title={t("trip.arrivalHeading")}
      description={t("trip.arrivalBody")}
      className={className}
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
      ) : null}
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-base font-semibold">{facts.label}</p>
          {facts.address ? (
            <address className="mt-1 text-sm text-muted not-italic">{facts.address}</address>
          ) : null}
          {facts.mapQuery ? (
            <a
              href={googleMapsUrl(facts.mapQuery)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-11 items-center font-medium text-primary hover:underline"
            >
              {t("trip.openArrivalMap")}
            </a>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
          {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}
        </p>
        <dl className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          {sites && sites.length > 0 ? (
            <div>
              <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold">
                {t("trip.arrivalSites")}
                {/* No `at`: the plan's own timestamp is what the change ledger
                    below already carries, and a second one here would be the
                    same fact twice. */}
                <FactSource kind="plan" label={t(DIVER_FACT_SOURCE_KEYS.plan)} />
              </dt>
              <dd className="mt-1 text-sm text-muted">
                {cachedListFormat(locale, { style: "long", type: "unit" }).format(sites)}
              </dd>
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
            <ArrivalFact label={t("trip.arrivalFirstInteraction")} value={facts.firstInteraction} />
          ) : null}
        </dl>
        {shop.contactPhone || shop.contactEmail ? (
          <p className="border-t border-border pt-4 text-sm text-muted">
            {t("trip.arrivalSupport")}{" "}
            <ShopContactLinks phone={shop.contactPhone} email={shop.contactEmail} />
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}
