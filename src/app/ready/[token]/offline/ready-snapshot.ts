import { arrivalCardFacts, arrivalDockCallLine } from "@/components/arrival-card-facts";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { arrivalCardDocument, escapeHtml, htmlDocument } from "@/lib/arrival-card-document";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { type ReadySnapshot, readyCopyKeepUntil } from "@/lib/ready-offline";
import type { ShopAddressParts } from "@/lib/shop-address";

/**
 * **Everything the offline copy may say, and nothing else** (issue #3225).
 * The route reads these fields off the verified booking one by one; there is
 * no page, no booking row and no token to serialize by accident. A field not
 * named here cannot reach a phone's Cache Storage.
 */
export type ReadySnapshotFacts = {
  locale: string;
  /** Server clock now. */
  generatedAt: number;
  shop: {
    name: string;
    timezone: string;
    contactPhone: string | null;
    contactEmail: string | null;
    address: ShopAddressParts;
    dockCallMinutes: number | null;
  };
  trip: {
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
  };
  /** A staff-set hotel pickup replaces the dock call. */
  pickup: { time: string | null; location: string | null };
};

function arrivalLine(facts: ReadySnapshotFacts, t: DiverTranslator): string | null {
  if (facts.pickup.time) {
    return t("ready.hotelPickupHeaderLine", {
      time: facts.pickup.time,
      location: facts.pickup.location ?? t("ready.hotelPickupLocationNotSet"),
    });
  }
  return arrivalDockCallLine(
    t,
    facts.trip.startsAt,
    facts.shop.dockCallMinutes,
    facts.locale,
    facts.shop.timezone,
  );
}

/**
 * The saved page, its two clock-warning variants and the instants the worker
 * dates the copy by. Absolute dates only: a "Tomorrow" printed now would be
 * wrong when read offline a day later. Copy is the diver bundle's, in the
 * locale the page was read in.
 */
export function buildReadySnapshot(facts: ReadySnapshotFacts): ReadySnapshot {
  const { locale, shop, trip } = facts;
  const t = diverTranslator(locale);
  const savedAt = formatDateTimeTz(new Date(facts.generatedAt), locale, shop.timezone);
  const point = arrivalCardFacts({ ...shop, slug: "" }, { ...trip, id: "", arrivalPhotoUrl: null });
  const card = {
    locale,
    title: `${t("trip.arrivalHeading")} · ${trip.title}`,
    shopName: shop.name,
    tripTitle: trip.title,
    when: `${formatShortDate(trip.startsAt, locale, shop.timezone)} · ${formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}`,
    dockCallLine: arrivalLine(facts, t),
    fields: [
      { label: t("trip.arrivalAtShop"), value: point.label },
      { label: t("trip.arrivalAddress"), value: point.address },
      { label: t("trip.arrivalLandmark"), value: point.landmark },
      { label: t("trip.arrivalLookFor"), value: point.lookFor },
      { label: t("trip.arrivalParking"), value: point.parkingNote },
      { label: t("trip.arrivalTransit"), value: point.transitNote },
      { label: t("trip.arrivalFirstInteraction"), value: point.firstInteraction },
      {
        label: t("trip.arrivalSupport"),
        value: [shop.contactPhone, shop.contactEmail].filter(Boolean).join(" · "),
      },
    ],
  };
  const banner = t("ready.offlineCopy", { when: savedAt });
  return {
    generatedAt: facts.generatedAt,
    keepUntil: readyCopyKeepUntil(trip),
    saved: arrivalCardDocument({ ...card, notices: [banner] }),
    unverified: arrivalCardDocument({
      ...card,
      notices: [banner, t("ready.offlineClockUnverified")],
    }),
    rollback: htmlDocument({
      locale,
      title: t("ready.offlineClockRollbackHeading"),
      bodyHtml: `<h1>${escapeHtml(t("ready.offlineClockRollbackHeading"))}</h1><p>${escapeHtml(t("ready.offlineClockRollbackSaved", { when: savedAt }))}</p>`,
    }),
  };
}
