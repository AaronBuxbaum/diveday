import type { Metadata } from "next";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { listShopDayDepartures } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { AutoPrint } from "../trips/[id]/_components/AutoPrint";
import {
  PACKET_READY_SELECTOR,
  PacketReady,
  TripPacket,
} from "../trips/[id]/print/_components/TripPacket";

export const metadata: Metadata = {
  title: "Day packet — DiveDay",
};

export const instant = true;

/**
 * **The paper day** (N-54): every departure of the shop's own calendar day as
 * one printable document, so a dead tablet costs a printer rather than the day.
 *
 * It is the trip packet, widened. Each departure contributes the same three
 * sections {@link TripPacket} renders for one — the dive plan, the manifest
 * (which carries the roster's waiver and readiness state and the shop's
 * emergency reference card) and the morning packing list — in clock order,
 * each on its own sheet. Nothing here reads the database for facts a departure
 * already knows how to state: the day is a list of trip ids and everything
 * under a heading comes from the same readers the screen used.
 *
 * **The day is the shop's own, not the server's.** `listShopDayDepartures`
 * brackets it with `shopDayBounds`, which is the whole point at the hour this
 * page exists for: at 05:00 in Florida the UTC date has already turned over,
 * and an instant-based window would hand a captain tomorrow's boats.
 *
 * **Its door is the morning end of the day spine** (`DaySpine.tsx`), above the
 * first station. The shop home *is* the day, the evening ritual already lives
 * at the bottom of that column, and printing the morning is the same kind of
 * act at the other end of it — a page in the "More" menu would have been a
 * destination nobody visits at 5 am with wet hands.
 *
 * There is no `?date=`. This prints today, which is the only day anyone has
 * ever wanted on paper at the counter, and it keeps an attacker-supplied
 * parameter off a document that carries every diver's emergency contact.
 */
export default async function ShopDayPrintPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const now = nowDate();
  const db = await getDb();
  const departures = await listShopDayDepartures(db, shop.id, shop.timezone, now);
  const packets = await Promise.all(
    departures.map((departure) =>
      TripPacket({
        shopSlug,
        shop,
        tripId: departure.id,
        actorPersonId: session.user.personId,
        locale,
        t,
      }),
    ),
  );
  // A departure deleted between the list and the read renders nothing at all,
  // rather than a blank block with a heading and no boat under it.
  const sheets = packets.flatMap((packet, index) =>
    packet ? [{ id: departures[index].id, packet }] : [],
  );

  return (
    <div className="trip-print-bundle">
      <AutoPrint readySelector={PACKET_READY_SELECTOR} />
      <header className="mb-10 border-b border-border pb-6 print:mb-6">
        <p className={EYEBROW_CLASS}>DiveDay</p>
        <h1 className={`mt-2 ${SHELL_TITLE_CLASS}`}>{t("shared.printPacket.dayTitle")}</h1>
        {/* The sheet has to say which day it is and how many boats it covers:
            paper outlives the morning it was printed, and a captain holding
            page 7 has no other way to know a boat is missing from it. */}
        <p className="mt-2 text-muted">
          {t("shared.printPacket.daySubtitle", {
            count: departures.length,
            date: formatDateWithYear(now, locale, shop.timezone),
          })}
        </p>
      </header>
      {sheets.map((sheet) => (
        <div key={sheet.id} className="contents">
          {sheet.packet}
        </div>
      ))}
      {departures.length === 0 ? <p>{t("shared.printPacket.dayEmpty")}</p> : null}
      <PacketReady />
    </div>
  );
}
