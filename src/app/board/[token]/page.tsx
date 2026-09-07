import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after, connection } from "next/server";
import { Fragment } from "react";
import { getDb } from "@/db/client";
import { type BoardDeparture, getDeparturesBoard } from "@/db/departures-board";
import { touchDisplayToken, verifyDisplayToken } from "@/db/display-tokens";
import type { Shop } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { seaStateText, temperatureText, windText } from "@/i18n/unit-labels";
import { nowDate } from "@/lib/clock";
import { boardTitleFor } from "@/lib/display-tokens";
import { formatShortDate, formatTime } from "@/lib/format";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { stageTone } from "@/lib/trip-stages";
import { BoardRefresh } from "./_components/BoardRefresh";

// `instant = true`: the segment's `loading.tsx` is the boundary, and the
// board paints its frame before the token verifies. See ADR
// 20260804-instant-navigation.
export const instant = true;

/**
 * A screen on a wall is never something to index — the URL is the credential
 * (docs/engineering/capability-telemetry-runbook.md). No Open Graph block, no
 * JSON-LD: nothing here describes a page anyone should share.
 */
export const metadata: Metadata = {
  title: "Departures — DiveDay",
  robots: { index: false, follow: false },
};

/** How often a screen re-reads the day. One minute is the stage word's own granularity. */
const REFRESH_MS = 60_000;

/**
 * **The departures board** (issue #1426, N-23): today's boats in clock order
 * for a lobby TV or a dock tablet, behind a revocable display link and no
 * sign-in.
 *
 * What it shows is the day spine read in a lobby's shape (`getDeparturesBoard`,
 * src/db/departures-board.ts): time, title, site and boat, the crew's own
 * stage word, "n of capacity aboard", where to meet, and the automated
 * outlook. What it never shows is decided at that reader by type — no diver
 * is named, no readiness, no phone number, no money — so nothing rendered
 * here can widen it. `show_names` on the link is the one switch, and it names
 * the crew.
 *
 * Display type: every fact a person reads from across a room is 24px or
 * larger, the chrome is nothing but the shop's name and the date, and the
 * page wears `boat-mode` so it follows the device's light or dark scheme at
 * the manifest's contrast rather than the app's.
 */
export default async function DeparturesBoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  const db = await getDb();
  // One answer for every failure — unknown, revoked — exactly as the calendar
  // feed answers. A screen shows the status code to nobody.
  const display = await verifyDisplayToken(db, { token });
  if (!display) notFound();
  const shop = await getShopById(db, display.shopId);
  if (!shop) notFound();

  const now = nowDate();
  const [locale, departures] = await Promise.all([
    requestLocale(shop.defaultLocale),
    getDeparturesBoard(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      showNames: display.showNames,
      now,
    }),
  ]);
  const t = diverTranslator(locale);
  // Off the response path: the stamp is for the settings page, not the screen.
  after(() => touchDisplayToken(db, { id: display.id, now }));

  const showsOutlook = departures.some((row) => row.outlook !== null);

  return (
    <main className="boat-mode flex min-h-screen flex-col bg-background px-6 py-6 text-foreground sm:px-10 sm:py-8 lg:px-14 lg:py-12">
      <BoardRefresh everyMs={REFRESH_MS} />
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <h1 className="text-[2rem] leading-tight font-bold tracking-tight text-balance lg:text-[2.75rem]">
          {shop.name}
        </h1>
        <p className="text-[1.5rem] leading-tight text-muted tabular-nums lg:text-[1.75rem]">
          {formatShortDate(now, locale, shop.timezone)}
        </p>
      </header>

      {departures.length === 0 ? (
        <p className="mt-16 text-[2rem] leading-tight text-muted text-balance">
          {t("board.empty")}
        </p>
      ) : (
        <ol className="mt-8 grid gap-4 lg:mt-10 lg:gap-5">
          {departures.map((row) => (
            <BoardRow key={row.tripId} row={row} shop={shop} locale={locale} t={t} />
          ))}
        </ol>
      )}

      <footer className="mt-auto flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 pt-10 text-[1.25rem] leading-tight text-muted">
        <p className="tabular-nums">
          {t("board.updated", { time: formatTime(now, locale, shop.timezone) })}
        </p>
        {/* Open-Meteo's licence requires attribution with a link back whenever
            its forecast is shown — the same credit the trip page carries. */}
        {showsOutlook ? (
          <p>
            {t("trip.forecastCreditPrefix")}{" "}
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              Open-Meteo
            </a>
          </p>
        ) : null}
      </footer>
    </main>
  );
}

function stageText(row: BoardDeparture, t: DiverTranslator): string | null {
  const stage = row.stage;
  if (!stage) return null;
  switch (stage.stage) {
    case "boarding":
      return t("board.stage.boarding");
    case "underway": {
      const site = stage.siteName ?? row.siteName;
      return site ? t("board.stage.underway", { site }) : t("board.stage.underwayNoSite");
    }
    case "surface":
      return t("board.stage.surface");
    case "heading_in":
      return t("board.stage.headingIn");
    case "home":
      return t("board.stage.home");
  }
}

function outlookParts(row: BoardDeparture, shop: Shop, t: DiverTranslator): string[] {
  const outlook = row.outlook;
  if (!outlook) return [];
  return [
    outlook.waterTemperatureC !== null
      ? t("trip.conditionsWater", {
          value: temperatureText(t, outlook.waterTemperatureC, temperatureUnitFor(shop)),
        })
      : null,
    outlook.seaState ? seaStateText(t, outlook.seaState).label : null,
    outlook.windState ? windText(t, outlook.windState).label : null,
  ].filter((part): part is string => Boolean(part));
}

/**
 * One boat. Three columns at a TV or a landscape tablet — the time, the boat,
 * the count — and one column on a phone, in the same order a person reads
 * them across a room: when, which, how full.
 */
function BoardRow({
  row,
  shop,
  locale,
  t,
}: {
  row: BoardDeparture;
  shop: Shop;
  locale: string;
  t: DiverTranslator;
}) {
  const title = boardTitleFor(row);
  const meta = [row.siteName, row.boatName].filter((part): part is string => Boolean(part));
  const meetingPoint = row.meetingPointLabel ?? row.meetingPointAddress;
  const stage = stageText(row, t);
  const outlook = outlookParts(row, shop, t);
  const stageClass =
    row.stage && stageTone(row.stage.stage) === "success" ? "text-success" : "text-primary";

  return (
    <li className="grid gap-x-8 gap-y-3 rounded-panel border border-border bg-surface px-6 py-5 sm:grid-cols-[auto_1fr_auto] sm:items-center lg:px-8 lg:py-6">
      <p className="text-[2.25rem] leading-none font-bold tabular-nums lg:text-[2.75rem]">
        {formatTime(row.startsAt, locale, shop.timezone)}
      </p>
      <div className="min-w-0">
        <p className="text-[1.75rem] leading-tight font-bold text-balance lg:text-[2.25rem]">
          {title.kind === "private" ? t("board.privateCharter") : title.title}
        </p>
        {meta.length > 0 ? (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[1.5rem] leading-tight text-muted">
            {meta.map((part, index) => (
              <Fragment key={part}>
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <span>{part}</span>
              </Fragment>
            ))}
          </p>
        ) : null}
        {meetingPoint ? (
          <p className="mt-1 text-[1.5rem] leading-tight">
            {t("board.meetAt", { place: meetingPoint })}
          </p>
        ) : null}
        {row.crewNames.length > 0 ? (
          <p className="mt-1 text-[1.5rem] leading-tight text-muted">
            {t("board.crew", { names: row.crewNames.join(", ") })}
          </p>
        ) : null}
        {outlook.length > 0 ? (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[1.5rem] leading-tight text-muted">
            {outlook.map((part, index) => (
              <Fragment key={part}>
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <span>{part}</span>
              </Fragment>
            ))}
          </p>
        ) : null}
      </div>
      <div className="sm:text-end">
        {stage ? (
          <p
            className={`text-[1.75rem] leading-tight font-bold text-balance lg:text-[2.25rem] ${stageClass}`}
          >
            {stage}
          </p>
        ) : null}
        <p className="text-[1.5rem] leading-tight tabular-nums lg:text-[1.75rem]">
          {t("board.aboard", { boarded: row.boarded, capacity: row.capacity })}
        </p>
      </div>
    </li>
  );
}
