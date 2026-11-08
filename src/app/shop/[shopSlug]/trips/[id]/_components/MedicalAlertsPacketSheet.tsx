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
 * **The trip packet with the medical alerts' words on it** (issue #2990, H-20261023-medical-alert-for-the
 * amendment of 2026-10-24): the departure's `?print=medical-alerts` state
 * (#2736), the same document as its `?print=1` packet, for a crew
 * whose phone is dead at sea, with each diver's alert under their row on the
 * manifest.
 *
 * The owner or a manager only (`canPersonPrintMedicalAlerts`, live roles);
 * anyone else, another shop's departure or one that is gone gets the same
 * 404, which says nothing about whether an alert exists. The words are read
 * here on the server, never from a page payload, and the print is the read:
 * `recordMedicalAlertsPrint` writes one `medical_alert_printed` line per diver
 * on the trail before the sheet renders, every print its own line. They
 * reach the manifest sheet as an argument (`readTripPacket`), never a URL value.
 *
 * **The trail says what was printed** (issue #3727): the words are read, the
 * packet is composed, and only a packet that came out stable (the departure is
 * still there and no reader disagreed) is recorded. A departure that vanished
 * is the 404, and one that changed mid-print answers its "changed" sheet with
 * no words and no line. The words are never rendered without a record: what
 * the sheet gets is what the trail took.
 * The default packet, the day's paper and the dispute sheet never take them.
 *
 * Opened only by "Print with medical alerts" (a `window.open` from a form
 * submit, never a prefetching link). A navigation from another site is a 404
 * before anything is read (`isCrossSiteHeaders`). The page has refused a
 * malformed trip id before it asks for this state (`departureStateOf`).
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
  let packet = await readTripPacket({ ...packetProps, printedMedicalAlerts: read.printed });
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
    // A diver whose line the trail refused keeps their words off the sheet:
    // compose it again with only what was recorded.
    if (printed.texts.size !== read.printed.texts.size) {
      packet = await readTripPacket({ ...packetProps, printedMedicalAlerts: printed });
      if (packet.status !== "stable") notFound();
    }
  }

  // **Its own title, on the paper too** (domain review 1, S3): the sheet in
  // the crew's hands says it carries the alerts and when they were printed,
  // so it is never mistaken for the plain packet.
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
