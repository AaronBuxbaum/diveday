import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { SECTION_TITLE_CLASS, SUB_TITLE_CLASS } from "@/components/ui/typography";
import { departureVessels } from "@/db/boats";
import { getDb } from "@/db/client";
import type { PrintedMedicalAlerts } from "@/db/medical-alerts";
import { getTripOverview } from "@/db/trip-overview";
import { readTripPaperIdentity } from "@/db/trip-paper-identity";
import { getTripPrepPage } from "@/db/trip-prep";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { PACKET_PAPER } from "@/lib/print-sheets";
import type { requireShopSurface } from "@/lib/session";
import { stablePacket } from "@/lib/stable-packet";
import { ShopSheet } from "../../../../print/_components/ShopSheet";
import {
  DeparturePaperIdentity,
  formatPaperDateTime,
} from "../../_components/DeparturePaperIdentity";
import { ManifestPaper } from "../../manifest/_components/ManifestPaper";
import { readManifestView } from "../../manifest/_components/manifest-view";
import { PrintedBoatPaper } from "../../manifest/_components/PrintedBoatProcedure";
import { PrepBody } from "../../prep/_components/PrepBody";
import { PacketDives } from "./PacketDives";

/**
 * The marker `AutoPrint` waits for before it opens the print dialog: the last
 * thing every packet renders, so its presence means the whole document has
 * mounted.
 */
export const PACKET_READY_SELECTOR = "[data-packet-ready]";

/** Renders {@link PACKET_READY_SELECTOR}. Place it last, inside the document. */
export function PacketReady() {
  return <div data-packet-ready className="contents" />;
}

type ShopSurface = Awaited<ReturnType<typeof requireShopSurface>>;

type TripPacketProps = Pick<ShopSurface, "shop" | "session"> & {
  shopSlug: string;
  /** Already validated as a UUID by the caller. */
  tripId: string;
  locale: string;
  t: StaffTranslator;
  /**
   * The medical alerts' words, only from "Print with medical alerts" (issue
   * #2990), which checked the printer and recorded the print first. Every
   * other caller (the packet, the day's paper) leaves it out: the flag only.
   */
  printedMedicalAlerts?: PrintedMedicalAlerts;
};

/**
 * **One sheet of a packet**: the shop's sheet (`ShopSheet`) on the packets'
 * paper, with the sheet's own name in the band.
 */
export function PacketSheet({
  shop,
  shopSlug,
  name,
  printed,
  children,
}: {
  shop: { name: string; brandColor: string | null };
  shopSlug: string;
  /** What this sheet is: "Manifest", "Prep", the day's title. */
  name: string;
  printed: string;
  children: ReactNode;
}) {
  return (
    <ShopSheet paper={PACKET_PAPER} shop={shop} shopSlug={shopSlug} name={name} printed={printed}>
      {children}
    </ShopSheet>
  );
}

/**
 * What a packet's document is: its sheets, given what leads the first one.
 *
 * **The lead rides on the first sheet rather than a cover of its own.** The
 * day's paper opens with which day it is and how many boats it holds; on a
 * sheet by itself that was a page with three lines on it, so it heads the
 * first boat's manifest sheet instead (or the warning that replaced it).
 */
export type PacketSheets = (lead?: ReactNode) => ReactNode;

/**
 * **One departure as two sheets** (issue #2745): the dive plan with the
 * manifest under it, for the boat, and the morning packing list, for the gear
 * room.
 *
 * Shared by the trip packet, the medical-alerts packet and the day's paper
 * (N-54), so the day is the *same* document repeated per departure rather
 * than a second assembly of the same facts.
 *
 * **Sheets, read from the readers the tabs use.** The Boat and Gear tabs and
 * these sheets build their facts in one place each (`readManifestView`,
 * `getTripPrepPage`), so the sheet cannot drift from the screen a captain just
 * reviewed; the sheets render the paper half of each (`ManifestPaper`,
 * `PrepBody`'s paper), which holds no control at all. Nothing interactive
 * reaches paper because nothing interactive is rendered, not because a
 * stylesheet hides it.
 *
 * Returns `null` for a departure that is gone. A missing trip is a `notFound()`
 * for the single-trip packet, whose whole subject it is; on the day's sheet it
 * is one boat of several, and the honest answer is to print the rest.
 */
async function composeTripPacket({
  shopSlug,
  shop,
  session,
  tripId,
  locale,
  t,
  printedMedicalAlerts,
}: TripPacketProps): Promise<PacketSheets | null> {
  const db = await getDb();
  // **The overview resolves alone, first.** It is the cheapest read and the
  // one that answers "is this departure still there", so the day's paper can
  // lose a boat without losing the rest of the stack.
  const details = await getTripOverview(db, shop, tripId, session.user.personId);
  if (!details) return null;

  // **Ids scoped to this departure.** The day's document holds one of these
  // per boat, and a repeated `aria-labelledby` target would point every
  // heading at the first boat's (`src/lib/element-id.ts`).
  const idPrefix = tripId;
  const now = nowDate();
  const [vessels, manifest, prep] = await Promise.all([
    departureVessels(db, shop.id, [tripId]),
    readManifestView({
      db,
      shop,
      session,
      shopSlug,
      tripId,
      idPrefix,
      printedMedicalAlerts,
      locale,
      t,
    }),
    getTripPrepPage(db, shop, tripId, now),
  ]);
  // A departure whose overview resolved but whose manifest or packing list
  // did not is gone in the window between the reads: the same `notFound()`
  // the tab pages answer with, which the trip packet turns into its 404 and
  // the day's paper settles into a dropped boat (`keptSheets`).
  if (manifest.status !== "ready" || !prep) notFound();
  const vessel = vessels.get(tripId);
  const identity = [
    shop.name,
    details.trip.title,
    `${formatPaperDateTime(details.trip.startsAt, locale, shop.timezone)} · ${shop.timezone}`,
    vessel?.name ?? "",
  ];
  const printed = `${t("print.sheet.printed", { date: formatPaperDateTime(now, locale, shop.timezone) })} · ${shop.timezone}`;
  // Which departure, at the head of each sheet: each starts a page of its
  // own, and the gear room's sheet still has to say which boat it is for.
  const head = (
    <header className="mb-6 border-b border-border pb-4">
      <h3 className={SECTION_TITLE_CLASS} data-packet-departure>
        {details.trip.title}
      </h3>
      <p className="mt-1 text-sm text-muted">
        {[
          // Out and due back: the return time is what an overdue-boat call
          // is measured against (dock-operator review of #3724).
          `${formatPaperDateTime(details.trip.startsAt, locale, shop.timezone)} – ${formatPaperDateTime(details.trip.endsAt, locale, shop.timezone)} · ${shop.timezone}`,
          vessel?.name,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </header>
  );
  const sheetShop = { name: shop.name, brandColor: shop.brandColor };

  return (lead) => (
    <>
      <DeparturePaperIdentity
        pageName={`departure-${tripId}-dives`}
        // The manifest's own running header: the boat, "Manifest" and the
        // roll-call checkpoint, on every page this sheet runs to.
        identity={manifest.paperIdentity.identity}
        printed={printed}
      >
        <PacketSheet
          shop={sheetShop}
          shopSlug={shopSlug}
          name={t("trips.surfaces.manifest")}
          printed={printed}
        >
          {lead}
          <section data-packet-section aria-labelledby={`print-dives-${tripId}`}>
            <h2 id={`print-dives-${tripId}`} className="sr-only">
              {t("shared.printPacket.divesHeading")}
            </h2>
            {head}
            <PacketDives
              dives={details.tripDiveList.map(({ dive, diveSite }) => ({
                diveNumber: dive.diveNumber,
                heading: diveSite?.name ?? dive.title,
                travelMinutes: dive.travelMinutes,
                description: dive.description,
              }))}
              description={details.trip.description}
              meetingPointLabel={details.trip.meetingPointLabel}
              meetingPointAddress={details.trip.meetingPointAddress}
              conditions={details.trip.conditionsSummary}
              t={t}
            />
          </section>
          {/* **The dive plan and the roll call share a sheet.** The plan is a
              title, a meeting point and a line per dive; on a page of its own
              it left most of the first sheet blank. */}
          <section
            data-packet-section
            aria-labelledby={`print-manifest-${tripId}`}
            className="mt-6 border-t border-border pt-6"
          >
            <h2 id={`print-manifest-${tripId}`} className="sr-only">
              {t("trips.surfaces.manifest")}
            </h2>
            <ManifestPaper
              cancelled={manifest.cancelled}
              manifest={manifest.manifest}
              vesselName={manifest.vessel?.name ?? null}
              boatSafety={manifest.boatSafety ? { ...manifest.boatSafety, idPrefix } : null}
              checklist={manifest.checklistProps}
              rollCall={manifest.rollCall}
              boatPaper={<PrintedBoatPaper {...manifest.boatPaper} />}
              stage={manifest.stage}
              dockDesk={manifest.dockDesk}
              printedDeckCount={manifest.printedDeckCount}
              t={t}
            />
          </section>
        </PacketSheet>
      </DeparturePaperIdentity>
      <DeparturePaperIdentity
        pageName={`departure-${tripId}-prep`}
        identity={[...identity, t("trips.surfaces.prep")]}
        printed={printed}
      >
        <PacketSheet
          shop={sheetShop}
          shopSlug={shopSlug}
          name={t("trips.surfaces.prep")}
          printed={printed}
        >
          <section data-packet-section aria-labelledby={`print-prep-${tripId}`}>
            <h2 id={`print-prep-${tripId}`} className="sr-only">
              {t("trips.surfaces.prep")}
            </h2>
            {head}
            <PrepBody
              prep={prep.prep}
              t={t}
              locale={locale}
              shopSlug={shopSlug}
              tripId={tripId}
              rentalItems={shop.rentalItems}
              notice={undefined}
              grouping="item"
              cancelled={prep.prep.trip.status === "cancelled"}
              sailed={prep.sailed}
              home={prep.finished}
              backFromBoat={prep.backFromBoat}
              groupPath=""
              emptyState={
                <EmptyState title={t("tripPrep.emptyHeading")} body={t("tripPrep.noDivers")} />
              }
              idPrefix={idPrefix}
              paper
              className="space-y-10"
            />
          </section>
        </PacketSheet>
      </DeparturePaperIdentity>
    </>
  );
}

/**
 * What a departure's packet came to: its sheets when every reader agreed
 * (`stable`), the one-sheet "this changed while we were printing" notice when
 * the identity moved under the reads (`changed`), or nothing when the
 * departure is gone (`missing`). Only a `stable` packet carries the departure's
 * facts, which is what "Print with medical alerts" asks before it writes the
 * trail (issue #3727).
 */
export type TripPacketResult =
  | { status: "missing" }
  | { status: "stable" | "changed"; sheets: PacketSheets };

/** Identity rows must stay unchanged throughout all independently composed readers. */
export async function readTripPacket(props: TripPacketProps): Promise<TripPacketResult> {
  const db = await getDb();
  const result = await stablePacket(
    () => readTripPaperIdentity(db, props.shop.id, props.tripId),
    async (identity) => {
      // The readers resolve the same authenticated shop; an identity edit
      // after that resolution must never be papered over with a newer header.
      if (identity.shopName !== props.shop.name || identity.timezone !== props.shop.timezone)
        return null;
      return composeTripPacket(props);
    },
  );
  if (result.status === "missing") return { status: "missing" };
  if (result.status === "stable" && result.packet) {
    return { status: "stable", sheets: result.packet };
  }
  const printed = `${formatPaperDateTime(nowDate(), props.locale, props.shop.timezone)} · ${props.shop.timezone}`;
  return {
    status: "changed",
    sheets: (lead) => (
      <DeparturePaperIdentity
        pageName={`departure-${props.tripId.toLowerCase()}-changed`}
        identity={[props.shop.name, props.t("shared.printPacket.changedHeading"), props.tripId]}
        printed={printed}
      >
        <PacketSheet
          shop={{ name: props.shop.name, brandColor: props.shop.brandColor }}
          shopSlug={props.shopSlug}
          name={props.t("shared.printPacket.changedHeading")}
          printed={printed}
        >
          {lead}
          <section role="alert">
            <h2 className={SUB_TITLE_CLASS}>{props.t("shared.printPacket.changedHeading")}</h2>
            <p className="mt-2">{props.t("shared.printPacket.changed", { id: props.tripId })}</p>
          </section>
        </PacketSheet>
      </DeparturePaperIdentity>
    ),
  };
}

/** The packet's sheets, or `null` for a departure that is gone (a changed one answers its notice). */
export async function TripPacket(props: TripPacketProps): Promise<PacketSheets | null> {
  const result = await readTripPacket(props);
  return result.status === "missing" ? null : result.sheets;
}
