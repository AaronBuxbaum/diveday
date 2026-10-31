import { arrivalCardFacts, arrivalDockCallLine } from "@/components/arrival-card-facts";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { PERSONAL_GEAR_KEYS } from "@/i18n/packing-labels";
import { CHECKLIST_DETAIL_KEYS } from "@/i18n/readiness-summary-labels";
import { arrivalCardDocument, escapeHtml, htmlDocument } from "@/lib/arrival-card-document";
import type { PersonalGearCode } from "@/lib/diver-planning";
import { type PlannedFlySafe, plannedFlySafeMessageKey } from "@/lib/fly-safe";
import {
  formatDateTimeTz,
  formatPlannedDateTimeTz,
  formatShortDate,
  formatTimeRangeTz,
} from "@/lib/format";
import type { ChecklistDetailCode } from "@/lib/readiness-summary";
import { type ReadySnapshot, readyCopyKeepUntil } from "@/lib/ready-offline";
import type { ShopAddressParts } from "@/lib/shop-address";
import { siteRunsLine } from "@/lib/site-runs";
import { tripChangeEntries } from "@/lib/trip-change-entries";

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
  /**
   * The checklist items still open for this diver, as the checklist's own
   * codes (certification card, physician's evaluation, waiver, payment...).
   * Voiced here with the page's sentences, as of `generatedAt`, never as a
   * claim that the diver is ready.
   */
  openItems: readonly ChecklistDetailCode[];
  /** Planned sites, dive one first. */
  sites: readonly string[];
  /** What to bring: personal gear codes, then the shop's own list. */
  packing: { personal: readonly PersonalGearCode[]; bring: readonly string[] };
  /** The trip's changes since this booking, as the page's ledger reads them. */
  changes: readonly TripChangeEvent[];
  /** When to fly home; null when nothing honest can be said. */
  flySafe: PlannedFlySafe | null;
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
  const openItems = facts.openItems.map((code) => t(CHECKLIST_DETAIL_KEYS[code]));
  const changes = tripChangeEntries(facts.changes, locale).map(
    ({ text, occurredAt, source }) =>
      `${text} (${t(source === "crew" ? "trip.changedByCrew" : "trip.changedByShop", { when: formatDateTimeTz(occurredAt, locale, shop.timezone) })})`,
  );
  const packing = [
    ...facts.packing.personal.map((code) => t(PERSONAL_GEAR_KEYS[code])),
    ...facts.packing.bring,
  ];
  const flySafe = facts.flySafe
    ? t(`ready.${plannedFlySafeMessageKey(facts.flySafe.reason)}`, {
        shopName: shop.name,
        when: formatPlannedDateTimeTz(facts.flySafe.from, locale, shop.timezone),
        count: facts.flySafe.hours,
      })
    : null;
  const card = {
    locale,
    title: `${t("trip.arrivalHeading")} · ${trip.title}`,
    shopName: shop.name,
    tripTitle: trip.title,
    when: `${formatShortDate(trip.startsAt, locale, shop.timezone)} · ${formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}`,
    dockCallLine: arrivalLine(facts, t),
    fields: [
      {
        label: t("ready.offlineOutstandingHeading"),
        value: openItems.length > 0 ? openItems.join("; ") : t("ready.offlineOutstandingNone"),
      },
      { label: t("trip.arrivalAtShop"), value: point.label },
      { label: t("trip.arrivalAddress"), value: point.address },
      {
        label: t("trip.arrivalSites"),
        value: facts.sites.length > 0 ? siteRunsLine(facts.sites, locale, t) : null,
      },
      { label: t("trip.arrivalLandmark"), value: point.landmark },
      { label: t("trip.arrivalLookFor"), value: point.lookFor },
      { label: t("trip.arrivalParking"), value: point.parkingNote },
      { label: t("trip.arrivalTransit"), value: point.transitNote },
      { label: t("trip.arrivalFirstInteraction"), value: point.firstInteraction },
      {
        label: t("trip.arrivalSupport"),
        value: [shop.contactPhone, shop.contactEmail].filter(Boolean).join(" · "),
      },
      { label: t("trip.packBring"), value: packing.join("; ") },
      { label: t("trip.changeLedgerHeading"), value: changes.join("; ") },
    ],
    // Says "Flying home soon?" itself, so it needs no label of its own.
    footerHtml: flySafe ? `<section><p>${escapeHtml(flySafe)}</p></section>` : "",
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
    staleNotice: t("ready.offlineStale"),
    rollback: htmlDocument({
      locale,
      title: t("ready.offlineClockRollbackHeading"),
      bodyHtml: `<h1>${escapeHtml(t("ready.offlineClockRollbackHeading"))}</h1><p>${escapeHtml(t("ready.offlineClockRollbackSaved", { when: savedAt }))}</p>`,
    }),
  };
}
