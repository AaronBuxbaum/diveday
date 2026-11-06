import type { ReactNode } from "react";
import {
  type ArrivalCardShop,
  type ArrivalCardTrip,
  arrivalCardFacts,
} from "@/components/arrival-card-facts";
import { PaperSheet, SheetMark } from "@/components/paper/PaperSheet";
import type { DiverTranslator } from "@/i18n/messages";
import { formatDateTimeTz, formatDateWithYear, formatTimeRangeTz } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { PACKET_PAPER, printSheetPageRule, storefrontAddress } from "@/lib/print-sheets";
import { siteRunsLine } from "@/lib/site-runs";
import { MastheadDays, type MastheadFacts, mastheadArrivalLine } from "./ReadyMasthead";

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-semibold">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

/**
 * **The diver's day on paper** (issue #2745): what the readiness thread
 * prints, before the dive. The thread's screen never reaches a printer: this
 * sheet is drawn under it, shown only to the printer (`data-paper-print-only`),
 * and on paper a page holding a sheet is its sheets (`globals.css`). So Ctrl+P
 * and a phone's share-sheet print both give the same page, and nothing printed
 * taps.
 *
 * It carries what the paper pass and the saved arrival card carry, from the
 * same readers: when, with the year and the zone (paper outlives the morning,
 * so never "Tomorrow"), when to be there (`mastheadArrivalLine`), where to go
 * (`arrivalCardFacts`), the planned sites, what to bring (`packing`, the
 * thread's own lists) and the shop's number, as words.
 *
 * **And nothing that makes the thread a bearer page.** No link, so not this
 * page's token and not the public trip's either; no booking id; no readiness,
 * waiver, medical or money state. This is the paper a diver leaves in a hotel
 * lobby, held to the arrival card's rule (`arrival-card/route.ts`): a hotel
 * pickup prints its time and never the hotel. The route's layout prints every
 * state of the page with no margin, so a browser has nowhere to write the
 * page's own address (`capabilityPagePrintRule`). The fixed line under the
 * facts says the paper is a snapshot and boarding is checked in person.
 */
export function ReadyDaySheet({
  t,
  locale,
  facts,
  arrival,
  sites,
  packing,
  asOf,
}: {
  t: DiverTranslator;
  locale: string;
  facts: MastheadFacts;
  arrival: { shop: ArrivalCardShop; trip: ArrivalCardTrip };
  /** The planned sites, in the order the day runs them. */
  sites: readonly string[];
  /** What to bring: `PackingLists`, drawn by the caller from the thread's reads. */
  packing: ReactNode;
  /** When this page read the booking: paper outlives the tab it was printed from. */
  asOf: Date;
}) {
  const { shop, trip } = facts;
  // Where a diver sleeps never goes on paper that can be left in a lobby:
  // the pickup prints its time and "your hotel", never the stored text.
  const paperFacts: MastheadFacts = { ...facts, pickup: { ...facts.pickup, location: null } };
  const zone = shop.timezone;
  const where = arrivalCardFacts(arrival.shop, arrival.trip);
  // A run's own window spans every day; day one's hours are the ones to state.
  const window = facts.days && facts.days.length > 1 ? facts.days[0] : trip;
  const support = [arrival.shop.contactPhone, arrival.shop.contactEmail]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="paper-sheet-frame" data-paper-print-only="">
      <div>
        {/* Fixed rules built from the sheet's own paper, never a request value. */}
        <style data-print-sheet="">{printSheetPageRule(PACKET_PAPER)}</style>
        <PaperSheet
          paper={PACKET_PAPER}
          band={
            <>
              <SheetMark name={shop.name} size="sm" />
              <span className="font-brand-display text-sm font-bold">{shop.name}</span>
              <span className="ms-auto text-sm font-semibold">{t("trip.arrivalHeading")}</span>
            </>
          }
          foldLeft={t("ready.sheetAsOf", { when: formatDateTimeTz(asOf, locale, zone) })}
          foldRight={storefrontAddress(shop.slug, publicAppUrl())}
        >
          <h1 className="font-brand-display text-xl leading-tight font-extrabold">{trip.title}</h1>
          <p className="mt-1 text-base">
            {formatDateWithYear(trip.startsAt, locale, zone)} ·{" "}
            {formatTimeRangeTz(window.startsAt, window.endsAt, locale, zone)}
          </p>
          <MastheadDays facts={facts} locale={locale} t={t} />
          <p className="mt-1 text-base font-semibold">
            {mastheadArrivalLine(paperFacts, locale, t)}
          </p>
          <dl className="mt-5 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
            <Fact label={t("trip.arrivalAtShop")} value={where.label} />
            <Fact label={t("trip.arrivalAddress")} value={where.address} />
            <Fact
              label={t("trip.arrivalSites")}
              value={sites.length > 0 ? siteRunsLine(sites, locale, t) : null}
            />
            <Fact label={t("trip.arrivalLandmark")} value={where.landmark} />
            <Fact label={t("trip.arrivalLookFor")} value={where.lookFor} />
            <Fact label={t("trip.arrivalParking")} value={where.parkingNote} />
            <Fact label={t("trip.arrivalTransit")} value={where.transitNote} />
            <Fact label={t("trip.arrivalFirstInteraction")} value={where.firstInteraction} />
          </dl>
          <div className="mt-5 border-t border-border pt-3">
            <h2 className="font-semibold">{t("trip.packTitle")}</h2>
            {packing}
          </div>
          <p className="mt-5 border-t border-border pt-3 text-sm">{t("ready.sheetCheck")}</p>
          {support ? (
            <p className="mt-5 border-t border-border pt-3 text-sm">
              {t("trip.arrivalSupport")} {support}
            </p>
          ) : null}
        </PaperSheet>
      </div>
    </div>
  );
}
