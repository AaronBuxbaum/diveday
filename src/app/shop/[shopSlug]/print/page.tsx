import type { Metadata } from "next";
import { after } from "next/server";
import { Fragment } from "react";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { listShopDayDepartures } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { settleWithLimit } from "@/lib/settle-with-limit";
import { AutoPrint } from "../trips/[id]/_components/AutoPrint";
import { keptSheets } from "../trips/[id]/print/_components/kept-sheets";
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
 * How many departures this document composes at once.
 *
 * Three, against a pool of five connections and roughly forty reads per
 * departure: enough to keep the pool busy, small enough that one captain's
 * printout cannot hold the whole instance's database access while a twenty-boat
 * day assembles (issue #1598). The reasoning in full, and the ordering and
 * failure guarantees this relies on, are in `src/lib/settle-with-limit.ts`.
 */
const DEPARTURES_IN_FLIGHT = 3;

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
  // **A few boats at a time, and `settled` rather than `all`.**
  //
  // The ceiling first, because it is the newer half (issue #1598). Each packet
  // is roughly forty database round trips — `getTripOverview`'s fifteen, the
  // manifest page's twelve and its field-guide follow-up, the prep page's own —
  // and the pool this instance holds is five connections
  // (`DEFAULT_POOL_MAX`). Asking for twenty departures at once does not run
  // eight hundred queries at once; it queues them, and while they queue this
  // one document owns every connection the app has. Any staff role can open
  // this page, and holding refresh multiplies it. Three in flight keeps those
  // five connections busy with a short queue behind them and leaves the rest of
  // the shop able to reach the database while a captain prints.
  //
  // Not `<Suspense>` per departure, which was the other candidate on the issue:
  // boundaries change when bytes flush, not how many reads start, so the
  // fan-out would have been exactly the same — and this document is only useful
  // whole (`AutoPrint` waits for `PacketReady` before opening the dialog), so
  // there is nobody to hand an early sheet to.
  //
  // **And settled, because one departure must never cost the other eleven.**
  // A manager can tap Delete on today's board while a captain's request for
  // this document is in flight, and the composed manifest page answers a
  // vanished departure the only way a page can — `notFound()`, which throws.
  // Inside `Promise.all` that rejection is the *day's* answer: the captain
  // gets a 404 instead of every other boat. `TripPacket` short-circuits the
  // ordinary case before it composes anything; this is the backstop for the
  // window that is left, and for anything else one departure's readers can
  // raise. A dropped sheet is not silent: the count in the header below is
  // `sheets.length`, so the paper says eleven when eleven is what it holds.
  const packets = await settleWithLimit(departures, DEPARTURES_IN_FLIGHT, (departure) =>
    TripPacket({
      shopSlug,
      shop,
      tripId: departure.id,
      actorPersonId: session.user.personId,
      locale,
      t,
    }),
  );
  const sheets = keptSheets(
    packets,
    departures.map((departure) => departure.id),
  );

  // **Counted here, on the document, rather than on the door.** The per-trip
  // packet records its click from a form because that button has to
  // `window.open` (issue #1599); the day's door is an ordinary link precisely
  // so a popup blocker has nothing to refuse, and a link tap that opens a new
  // tab leaves no server call behind on the page that held it. The page itself
  // is the honest place: it counts an open however it was reached — the spine's
  // door, a refresh, a bookmarked URL — and `after()` keeps the measurement off
  // the render's path, the same shape the shop home uses for
  // `blockers_surfaced`.
  after(() =>
    trackEvent({ name: "day_print_opened", surface: "day_spine", departures: sheets.length }),
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
            // `sheets.length`, never `departures.length`: this number is the
            // only thing that tells a captain holding page seven that a boat
            // is missing from the stack.
            count: sheets.length,
            date: formatDateWithYear(now, locale, shop.timezone),
          })}
        </p>
      </header>
      {/* **A `Fragment`, not a wrapper div.** The page breaks between sheets
          are `globals.css`'s `.print-bundle-page:first-of-type { break-before:
          auto }`, which exempts the *first* section of its parent — so a
          per-departure wrapper made every departure's dive plan a first child
          and printed it on the back of the previous boat's packing list.
          `display: contents` does not help: it is a layout value and selectors
          still match the real tree. Keeping every section a sibling is what
          makes exactly one of them the first. */}
      {sheets.map((sheet) => (
        <Fragment key={sheet.id}>{sheet.packet}</Fragment>
      ))}
      {sheets.length === 0 ? <p>{t("shared.printPacket.dayEmpty")}</p> : null}
      <PacketReady />
    </div>
  );
}
