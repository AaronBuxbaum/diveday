import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { medicalAlertsForPrint } from "@/db/medical-alerts";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { isCrossSiteHeaders } from "@/lib/same-origin";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { SheetDocument } from "../../../../print/_components/SheetDocument";
import { PACKET_READY_SELECTOR, PacketReady, TripPacket } from "../_components/TripPacket";

export const metadata: Metadata = {
  title: "Trip packet with medical alerts — DiveDay",
};

// The same instant-navigation contract as the packet it extends.
export const instant = true;

/**
 * **The trip packet with the medical alerts' words on it** (issue #2990, H-20261023-medical-alert-for-the
 * amendment of 2026-10-24): the same document as `../page.tsx`, for a crew
 * whose phone is dead at sea, with each diver's alert under their row on the
 * manifest.
 *
 * The owner or a manager only (`canPersonPrintMedicalAlerts`, live roles);
 * anyone else, another shop's departure or one that is gone gets the same
 * 404, which says nothing about whether an alert exists. The words are read
 * here on the server, never from a page payload, and the print is the read:
 * `medicalAlertsForPrint` writes one `medical_alert_printed` line per diver
 * on the trail before the sheet renders, every print its own line. They
 * reach the manifest sheet as an argument (`TripPacket`), never a URL value.
 * The default packet, the day's paper and the dispute sheet never take them.
 *
 * Opened only by "Print with medical alerts" (a `window.open` from a form
 * submit, never a prefetching link). A navigation from another site is a 404
 * before anything is read (`isCrossSiteHeaders`).
 */
export default async function TripPrintWithMedicalAlertsPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const resolvedParams = await params;
  const { id } = resolvedParams;
  if (!uuidParam(id)) notFound();
  // A GET that writes the trail: another site's `window.open` carries the
  // session cookie (SameSite=Lax), so it is refused with the same 404 before
  // anything is read or recorded (security review of #2990, M1).
  if (isCrossSiteHeaders(await headers())) notFound();
  const tripId = id;

  const { shop, session, db } = await requireShopSurface(resolvedParams.shopSlug);
  const printed = await medicalAlertsForPrint(db, {
    shopId: shop.id,
    tripId,
    printerId: session.user.personId,
  });
  if (!printed.ok) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const packet = await TripPacket({
    shopSlug: resolvedParams.shopSlug,
    shop,
    session,
    tripId,
    locale,
    t,
    printedMedicalAlerts: printed.printed,
  });
  if (!packet) notFound();

  // **Its own title, on the paper too** (domain review 1, S3): the sheet in
  // the crew's hands says it carries the alerts and when they were printed,
  // so it is never mistaken for the plain packet.
  const title = (
    <header className="mb-6 border-b border-border pb-4">
      <h1 className={SHELL_TITLE_CLASS}>{t("manifest.medicalAlertsPrintedTitle")}</h1>
      <p className="mt-2 text-muted">
        {t("print.sheet.printed", {
          date: formatDateTimeTz(printed.printed.printedAt, locale, shop.timezone),
        })}
      </p>
    </header>
  );

  return (
    <SheetDocument
      backHref={shopPath(resolvedParams.shopSlug, "trips", tripId)}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("trips.tabs.divers")}
      printLabel={t("print.sheet.door")}
      readySelector={PACKET_READY_SELECTOR}
      // The words reach the crew's sheet, never this screen (layer 4 security
      // review, note 1): the screen says only what is printing and when.
      printOnly={title}
    >
      {packet(title)}
      <PacketReady />
    </SheetDocument>
  );
}
