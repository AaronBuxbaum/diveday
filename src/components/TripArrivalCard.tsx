import { ShopContactLinks } from "@/components/ShopContactLinks";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SectionCard } from "@/components/ui/card";
import { diverTranslator } from "@/i18n/messages";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { googleMapsUrl } from "@/lib/maps";
import { type ShopAddressParts, shopAddressLines, shopMapQuery } from "@/lib/shop-address";

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

/** The public, non-sensitive arrival projection shared by trip and Ready. */
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
    firstInteraction: clean(trip.arrivalFirstInteraction),
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

/** One compact, public place-to-go card. No booking, waiver, or capability state crosses in. */
export function TripArrivalCard({
  shop,
  trip,
  locale,
  className = "",
}: {
  shop: ArrivalCardShop;
  trip: ArrivalCardTrip;
  locale: string;
  className?: string;
}) {
  const t = diverTranslator(locale);
  const facts = arrivalCardFacts(shop, trip);
  return (
    <SectionCard
      title={t("trip.arrivalHeading")}
      description={t("trip.arrivalBody")}
      className={className}
    >
      {facts.photoUrl ? (
        <StoredPhoto
          src={facts.photoUrl}
          alt={t("trip.arrivalImageAlt", { place: facts.label })}
          className="mb-5 aspect-[16/9] rounded-xl"
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
