import { earliestReportedTripStart, getSafetyPage } from "@/db/safety-report";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  addMonths,
  clampMonth,
  compareMonths,
  isoDate,
  type MonthRef,
  monthKey,
  parseMonthKey,
} from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear, formatMonthDay, formatTimeZoneName } from "@/lib/format";
import type { ShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { shopMonthBounds, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import type { MonthFigure } from "../../reports/_components/MonthFigures";
import { crewSafetyValue } from "./crew-safety-value";
import { safetyMonthTiles } from "./safety-month-tiles";

/**
 * **The Safety report, read once** for the screen and for the sheet printed
 * from it (issue #2745): the month or year `?month=` / `?year=` names, the
 * figures, the month's tiles and the lists behind them. The screen draws them
 * with its stepper; the sheet draws the same values with no control on it.
 */
export async function readSafetyReport({
  shopSlug,
  session,
  db,
  shop,
  month,
  year: yearParam,
}: Pick<ShopSurface, "session" | "db" | "shop"> & {
  shopSlug: string;
  month: string | undefined;
  year: string | undefined;
}) {
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const tz = shop.timezone;
  const now = nowDate();

  const todayWall = utcToWallTime(now, tz);
  const thisMonth: MonthRef = { year: todayWall.year, month: todayWall.month };
  const earliest = await earliestReportedTripStart(db, shop.id);
  const earliestWall = earliest ? utcToWallTime(earliest, tz) : null;
  const floor: MonthRef =
    earliestWall &&
    compareMonths({ year: earliestWall.year, month: earliestWall.month }, thisMonth) < 0
      ? { year: earliestWall.year, month: earliestWall.month }
      : thisMonth;
  // No later than this month: nothing has come back from a month not yet sailed.
  const parsed = parseMonthKey(month) ?? thisMonth;
  const current = clampMonth(compareMonths(parsed, thisMonth) > 0 ? thisMonth : parsed, floor);
  const isThisMonth = compareMonths(current, thisMonth) === 0;
  // **The year the insurer renews on** (fifth loop, item 33): `?year=` reads
  // the same figures over the whole year, one page for the broker instead of
  // twelve, floored at the shop's first year and never past this one.
  const year = safetyYear(yearParam, floor.year, thisMonth.year);
  const prevKey = year
    ? year.number > floor.year
      ? `year=${year.number - 1}`
      : null
    : compareMonths(current, floor) > 0
      ? `month=${monthKey(addMonths(current, -1))}`
      : null;
  const nextKey = year
    ? year.isThisYear
      ? null
      : `year=${year.number + 1}`
    : isThisMonth
      ? null
      : `month=${monthKey(addMonths(current, 1))}`;

  const { from, to } = year ? year.bounds(tz) : shopMonthBounds(current, tz);
  // The year is the sum of its months, each read by its own rules (review F1).
  const { yearMonths, safety, incidents } = await getSafetyPage(
    db,
    shop.id,
    session.user.personId,
    {
      year: year ? year.number : null,
      from,
      to,
      timeZone: tz,
      now,
    },
  );
  // A draft is unfinished and can still be discarded, so the figure counts
  // filed reports and names the drafts beside them (review F4).
  const draftReports = incidents.filter((report) => report.status === "draft").length;

  const lastDay = new Date(Date.UTC(current.year, current.month, 0)).getUTCDate();
  const activityHref = year
    ? `${shopPath(shopSlug, "settings", "activity")}?kind=safety&from=${isoDate(year.number, 1, 1)}&to=${isoDate(year.number, 12, 31)}`
    : `${shopPath(shopSlug, "settings", "activity")}?kind=safety&from=${isoDate(current.year, current.month, 1)}&to=${isoDate(current.year, current.month, lastDay)}`;
  const crew = crewSafetyValue(safety, t);
  const figures: MonthFigure[] = [
    {
      key: "rollCalls",
      label: t("incidents.safety.rollCalls"),
      value: t("incidents.safety.rollCallsValue", {
        closed: safety.rollCallsClosed,
        back: safety.departuresBack,
      }),
      // The year lists nothing, so it says where the open ones are (review N8).
      detail:
        year && safety.openRollCalls.length > 0
          ? `${t("incidents.safety.rollCallsDetail", { back: safety.departuresBack })} · ${t(
              "incidents.safety.year.rollCallsOpen",
              // A boat that sailed with no head count at all is a worse fact
              // than a count left open, so the year keeps them apart (chain-r5
              // review F2), as each month's list does.
              {
                open: safety.openRollCalls.filter((row) => row.closure === "open").length,
                none: safety.openRollCalls.filter((row) => row.closure === "none").length,
              },
            )}`
          : t("incidents.safety.rollCallsDetail", { back: safety.departuresBack }),
      detailTone: safety.openRollCalls.length > 0 ? "attention" : "quiet",
    },
    {
      key: "boarded",
      label: t("incidents.safety.boarded"),
      value: String(safety.boardedAtDock),
      detail: t(year ? "incidents.safety.year.boardedDetail" : "incidents.safety.boardedDetail", {
        count: safety.unmarkedAtDock,
      }),
      detailTone: safety.unmarkedAtDock > 0 ? "attention" : "quiet",
    },
    {
      key: "certOverrides",
      label: t("incidents.safety.certOverrides"),
      value: String(safety.certOverrides),
      link: {
        href: activityHref,
        label: t(
          year ? "incidents.safety.year.activityLink" : "incidents.safety.certOverridesLink",
        ),
      },
    },
    {
      key: "crew",
      label: t("incidents.safety.crew"),
      // A zero over crew with nothing on file is not a clean record: the
      // lapsed count stands over the sailings it judged, the detail says how
      // much it could not judge, and a month with nothing on file at all
      // shows no ratio (third review, item 2).
      value: crew.value,
      detail: crew.detail,
      detailTone: crew.attention ? "attention" : "quiet",
      ...(safety.unknownCredentialSailings
        ? {
            link: {
              href: shopPath(shopSlug, "settings", "team"),
              label: t("incidents.safety.currentCrewCredentials"),
            },
          }
        : {}),
    },
    // **A boat nobody is recorded driving is a figure, not a silence**
    // (fourth review, item 13): such a departure never reaches the crew check,
    // so the tile beside it read "0 of 0" for the emptiest record.
    // A month with no crew recorded anywhere is a shop that does not roster
    // crew here, not a fleet that sailed unmanned: one quiet line and no
    // figure, rather than every boat in attention (review F1). The year sums
    // its months by that rule and says how many had none (dive-domain F1);
    // the denominator is boats, as the figure is (N5).
    safety.noCrewOnRecord
      ? {
          key: "noCrew",
          label: t("incidents.safety.noCrew"),
          value: "—",
          detail: t(year ? "incidents.safety.year.noCrewNone" : "incidents.safety.noCrewNone"),
          detailTone: "quiet",
        }
      : {
          key: "noCrew",
          label: t("incidents.safety.noCrew"),
          value: String(safety.noCrewDepartures.length),
          ...noCrewDetail(),
        },
    {
      key: "incidents",
      label: t("incidents.safety.incidents"),
      value: t("incidents.safety.incidentsValue", {
        filed: incidents.length - draftReports,
        drafts: draftReports,
      }),
    },
  ];

  const monthTiles = safetyMonthTiles({
    t,
    safety,
    filed: incidents.length - draftReports,
    drafts: draftReports,
    activityHref,
    staffingHref: shop.crewScheduleEnabled ? shopPath(shopSlug, "staffing") : null,
    teamHref: shopPath(shopSlug, "settings", "team"),
  });

  function noCrewDetail(): Pick<MonthFigure, "detail" | "detailTone"> {
    const parts = [
      safety.noCrewDepartures.length > 0
        ? t(year ? "incidents.safety.year.noCrewDetail" : "incidents.safety.noCrewDetail", {
            back: safety.boatsBack,
          })
        : null,
      yearMonths && yearMonths.monthsWithoutCrew > 0
        ? t("incidents.safety.year.noCrewMonths", {
            none: yearMonths.monthsWithoutCrew,
            months: yearMonths.monthsBack,
          })
        : null,
    ].filter((part): part is string => part !== null);
    if (parts.length === 0) return {};
    return {
      detail: parts.join(" · "),
      detailTone: safety.noCrewDepartures.length > 0 ? "attention" : "quiet",
    };
  }

  // On paper the year must say whose record it is, over which days, in which
  // zone, and when it was printed (review F3): a broker's file holds many.
  const printedFor = year
    ? t("incidents.safety.year.printedFor", {
        shopName: shop.name,
        start: formatMonthDay(1, 1, locale),
        end: year.isThisYear
          ? formatMonthDay(todayWall.month, todayWall.day, locale)
          : formatMonthDay(12, 31, locale),
        year: String(year.number),
        zone: formatTimeZoneName(locale, tz, now),
      })
    : t("incidents.safety.year.printedFor", {
        shopName: shop.name,
        start: formatMonthDay(current.month, 1, locale),
        end: formatMonthDay(current.month, isThisMonth ? todayWall.day : lastDay, locale),
        year: String(current.year),
        zone: formatTimeZoneName(locale, tz, now),
      });

  return {
    t,
    locale,
    tz,
    year,
    current,
    isThisMonth,
    prevKey,
    nextKey,
    safety,
    incidents,
    figures,
    monthTiles,
    printedFor,
    printedOn: formatDateWithYear(now, locale, tz),
    now,
  };
}

/**
 * `?year=` parsed, never trusted: four digits between the shop's first year and
 * this one, or no year at all (the month view).
 */
function safetyYear(raw: string | undefined, firstYear: number, thisYear: number) {
  const number = raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
  if (number === null || number < firstYear || number > thisYear) return null;
  return {
    number,
    isThisYear: number === thisYear,
    bounds: (timeZone: string) => ({
      from: wallTimeToUtc({ year: number, month: 1, day: 1, hour: 0, minute: 0 }, timeZone),
      to: wallTimeToUtc({ year: number + 1, month: 1, day: 1, hour: 0, minute: 0 }, timeZone),
    }),
  };
}
