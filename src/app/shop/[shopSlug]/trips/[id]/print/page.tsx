import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";
import { AutoPrint } from "../_components/AutoPrint";
import { PacketSummary } from "./_components/PacketDocument";
import { PACKET_READY_SELECTOR, PacketReady, TripPacket } from "./_components/TripPacket";

export const metadata: Metadata = {
  title: "Trip packet — DiveDay",
};

// The trip layout owns the blocking staff shell; this page still opts into the
// same instant-navigation contract as the pages it composes.
export const instant = true;

/**
 * A readable print packet, not live controls. Overview-only facts render as
 * text; hiding controls alone would omit them. Manifest and Prep remain the
 * source for their facts. `.trip-print-bundle` control hiding is a backstop,
 * and sections are shared through `TripPacket` to keep the trip and day's
 * packets aligned. `e2e/trips.spec.ts` expects zero controls in print output.
 */
export default async function TripPrintPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const resolvedParams = await params;
  const { id } = resolvedParams;
  const tripId = uuidParam(id);
  if (!tripId) notFound();

  const { shop, session } = await requireShopSurface(resolvedParams.shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const packet = await TripPacket({
    shopSlug: resolvedParams.shopSlug,
    shop,
    tripId,
    actorPersonId: session.user.personId,
    locale,
    t,
  });
  // The same answer the Overview page gives a trip that is gone or another
  // shop's — the reader is scoped by the shop this surface already resolved.
  if (!packet) notFound();

  return (
    <div className="trip-print-bundle" data-paper-screen>
      {/* Wait for the packet's own ready marker before opening print. */}
      <AutoPrint readySelector={PACKET_READY_SELECTOR} />
      <PacketSummary openingPageName={packet.openingPageName}>
        <p className={EYEBROW_CLASS}>DiveDay</p>
        <h1 className={`mt-2 ${SHELL_TITLE_CLASS}`}>{t("shared.printPacket.title")}</h1>
        {/* The roll call on this paper is the moment it was printed, not the
            boat's: a packet printed before boarding and read after it would
            otherwise pass for the current head count. */}
        <p className="mt-2 text-muted">
          {t("print.sheet.printed", {
            date: formatDateTimeTz(nowDate(), locale, shop.timezone),
          })}
        </p>
      </PacketSummary>
      {packet.document}
      <PacketReady />
    </div>
  );
}
