import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import {
  type PrintedMedicalAlerts,
  readMedicalAlertsForPrint,
  recordMedicalAlertsPrint,
} from "@/db/medical-alerts";
import { isCrossSiteHeaders } from "@/features/same-origin";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { SheetDocument } from "../../../print/_components/SheetDocument";
import { PACKET_READY_SELECTOR, PacketReady, readTripPacket } from "./packet/TripPacket";

/**
 * The trip packet includes medical alerts for active shop staff. The server
 * checks the tenant and live role, records each disclosed alert, and only
 * renders words that were recorded. Cross-site navigations are refused.
 */
export async function MedicalAlertsPacketSheet({
  shopSlug,
  tripId,
}: {
  shopSlug: string;
  tripId: string;
}) {
  // A GET that writes the trail: another site's `window.open` carries the
  // session cookie (SameSite=Lax), so it is refused with the same 404 before
  // anything is read or recorded (security review of #2990, M1).
  if (isCrossSiteHeaders(await headers())) notFound();

  const { shop, session, db } = await requireShopSurface(shopSlug);
  const read = await readMedicalAlertsForPrint(db, {
    shopId: shop.id,
    tripId,
    printerId: session.user.personId,
  });
  if (!read.ok) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const packetProps = {
    shopSlug,
    shop,
    session,
    tripId,
    locale,
    t,
  };
  const packet = await readTripPacket({ ...packetProps, printedMedicalAlerts: read.printed });
  if (packet.status === "missing") notFound();
  // Only a packet that will print is recorded. A "changed" sheet carries no
  // words, so it leaves no line and wears no medical title.
  let printed: PrintedMedicalAlerts | null = null;
  if (packet.status === "stable") {
    printed = await recordMedicalAlertsPrint(db, {
      shopId: shop.id,
      tripId,
      printerId: session.user.personId,
      read,
    });
    // Never produce a packet missing an alert because its audit write failed.
    if (printed.texts.size !== read.printed.texts.size) notFound();
  }

  // The paper identifies the included alerts and when they were printed.
  const title = printed && (
    <header className="mb-6 border-b border-border pb-4">
      <h1 className={SHELL_TITLE_CLASS}>{t("manifest.medicalAlertsPrintedTitle")}</h1>
      <p className="mt-2 text-muted">
        {t("print.sheet.printed", {
          date: formatDateTimeTz(printed.printedAt, locale, shop.timezone),
        })}
      </p>
    </header>
  );

  return (
    <SheetDocument
      backHref={shopPath(shopSlug, "trips", tripId)}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("trips.tabs.divers")}
      printLabel={t("print.sheet.door")}
      readySelector={PACKET_READY_SELECTOR}
      // The words reach the crew's sheet, never this screen (layer 4 security
      // review, note 1): the screen says only what is printing and when.
      printOnly={title || undefined}
    >
      {packet.sheets(title || undefined)}
      <PacketReady />
    </SheetDocument>
  );
}
