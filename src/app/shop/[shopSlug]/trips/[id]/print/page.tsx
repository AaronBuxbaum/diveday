import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { SheetDocument } from "../../../print/_components/SheetDocument";
import { PACKET_READY_SELECTOR, PacketReady, TripPacket } from "./_components/TripPacket";

export const metadata: Metadata = {
  title: "Trip packet — DiveDay",
};

// The trip layout owns the blocking staff shell; this page still opts into the
// same instant-navigation contract as the tabs it prints.
export const instant = true;

/**
 * **The trip packet: one departure's sheets** (issue #2745). The manifest
 * sheet (with the dive plan above the roll call) and the packing-list sheet,
 * in the shop's colour, through the same `SheetDocument` every printed page
 * uses. What a captain reviews on screen is the paper that comes out, and it
 * holds no control because none is rendered. `e2e/trips.spec.ts` asks the
 * printed document for zero controls.
 */
export default async function TripPrintPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { shopSlug, id } = await params;
  const tripId = uuidParam(id);
  if (!tripId) notFound();

  const { shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const packet = await TripPacket({ shopSlug, shop, session, tripId, locale, t });
  // The same answer the Overview page gives a trip that is gone or another
  // shop's — the reader is scoped by the shop this surface already resolved.
  if (!packet) notFound();

  return (
    <SheetDocument
      backHref={shopPath(shopSlug, "trips", tripId)}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("trips.tabs.divers")}
      printLabel={t("print.sheet.door")}
      readySelector={PACKET_READY_SELECTOR}
    >
      <h1 className="sr-only">{t("shared.printPacket.title")}</h1>
      {packet()}
      <PacketReady />
    </SheetDocument>
  );
}
