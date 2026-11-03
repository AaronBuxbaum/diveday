import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { Fragment } from "react";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { listShopDayDepartures } from "@/db/trips";
import { readDayLoadOut, tomorrowNoon } from "@/features/today";
import { dayLoadOutLine } from "@/i18n/load-out-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { settleWithLimit } from "@/lib/settle-with-limit";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { formatPaperDateTime } from "../trips/[id]/_components/DeparturePaperIdentity";
import { keptSheets } from "../trips/[id]/print/_components/kept-sheets";
import {
  PACKET_READY_SELECTOR,
  PacketReady,
  PacketSheet,
  TripPacket,
} from "../trips/[id]/print/_components/TripPacket";
import { SheetDocument } from "./_components/SheetDocument";

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
 * It is the trip packet, widened. The day's own sheet first (which day, how
 * many boats, the load-out), then each departure's two sheets {@link
 * TripPacket} renders for one — the dive plan over the manifest (which carries
 * the roster's waiver and readiness state and the shop's emergency reference
 * card), and the morning packing list — in clock order. Nothing here reads the database for facts a departure
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
 * There is no `?date=`. This prints today, which is the day anyone wants on
 * paper at the counter, and it keeps an attacker-supplied date off a document
 * that carries every diver's emergency contact. **The one other day is a fixed
 * word, `?day=tomorrow`** (fifth-loop ideas, item 2): the evening close's
 * "Print tomorrow", for the fill station and the gear room working tonight,
 * and a permanent door on today's sheet (a night boat's evening close comes
 * late; dive-domain review N1). Any other value prints today; there is still
 * no way to name a date.
 *
 * The header adds the day's tanks and rental pieces across every boat, and,
 * when there is nitrox to fill, says once what that count is: seats with a
 * verified card, every mix still analyzed and signed for at the fill station
 * (H-20260730-nitrox-fill-station-procedure: a count, never a fill log). It used to sit under every boat's tiles.
 */
export default async function ShopDayPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { shopSlug } = await params;
  const tomorrow = (await searchParams).day === "tomorrow";
  const { shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const now = nowDate();
  const db = await getDb();
  // Any instant inside the day to print: now, or noon on the shop's next day.
  const dayAt = tomorrow ? tomorrowNoon(now, shop.timezone) : now;
  const [departures, loadOut] = await Promise.all([
    listShopDayDepartures(db, shop.id, shop.timezone, dayAt),
    readDayLoadOut(db, shop, dayAt, now),
  ]);
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
      session,
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

  const printed = `${t("print.sheet.printed", { date: formatPaperDateTime(now, locale, shop.timezone) })} · ${shop.timezone}`;
  const dayTitle = t(
    tomorrow ? "shared.printPacket.dayTitleTomorrow" : "shared.printPacket.dayTitle",
  );

  const summary = (
    <header className="mb-6 border-b border-border pb-4">
      <h1 className={SECTION_TITLE_CLASS}>{dayTitle}</h1>
      <p className="mt-2 text-muted">
        {t("shared.printPacket.daySubtitle", {
          // `sheets.length`, never `departures.length`: this number is the
          // only thing that tells a captain holding page seven that a boat
          // is missing from the stack.
          count: sheets.length,
          date: formatDateWithYear(dayAt, locale, shop.timezone),
        })}
      </p>
      {loadOut ? <p className="mt-1 tabular-nums">{dayLoadOutLine(t, loadOut)}</p> : null}
      {loadOut && loadOut.tanks.nitrox > 0 ? (
        <p className="mt-1 text-sm text-muted">{t("tripPrep.nitroxCountNote")}</p>
      ) : null}
    </header>
  );

  return (
    <SheetDocument
      backHref={shopPath(shopSlug)}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t(STAFF_DESTINATION_LABEL_KEYS.today)}
      printLabel={t("print.sheet.door")}
      readySelector={PACKET_READY_SELECTOR}
      doors={
        tomorrow ? null : (
          <Link
            href={`${shopPath(shopSlug, "print")}?day=tomorrow`}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("shared.printPacket.dayDoorTomorrow")}
          </Link>
        )
      }
    >
      {/* **Which day, how many boats, and the load-out**, at the head of
          the first sheet (or on a sheet of its own on an empty day). Paper
          outlives the morning it was printed, and a captain holding page 7
          has no other way to know a boat is missing from the stack. */}
      {sheets.length === 0 ? (
        <PacketSheet
          shop={{ name: shop.name, brandColor: shop.brandColor }}
          shopSlug={shopSlug}
          name={dayTitle}
          printed={printed}
        >
          {summary}
          <p className="mt-4">
            {t(tomorrow ? "shared.printPacket.dayEmptyTomorrow" : "shared.printPacket.dayEmpty")}
          </p>
        </PacketSheet>
      ) : (
        sheets.map((sheet, index) => (
          <Fragment key={sheet.id}>{sheet.packet(index === 0 ? summary : undefined)}</Fragment>
        ))
      )}
      <PacketReady />
    </SheetDocument>
  );
}
