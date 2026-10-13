import type { Metadata } from "next";
import Link from "next/link";
import { CREDENTIAL_KIND_KEYS } from "@/app/shop/[shopSlug]/settings/team/credential-kinds";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { listShopIncidentReports } from "@/db/incident-reports";
import { canPersonViewShopReports, earliestReportedTripStart } from "@/db/reporting";
import { getSafetyMonth } from "@/db/safety-report";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  addMonths,
  clampMonth,
  compareMonths,
  isoDate,
  type MonthRef,
  monthKey,
  monthLabel,
  parseMonthKey,
} from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { shopMonthBounds, utcToWallTime } from "@/lib/zoned";
import { StaffSectionTabs } from "../../_components/StaffSectionTabs";
import { type MonthFigure, MonthFigures } from "../_components/MonthFigures";
import { SafetyLists } from "./_components/SafetyLists";

// Paints from its own `loading.tsx`, like Reports (ADR 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = {
  title: "Safety — DiveDay",
};

/**
 * **The month's safety, beside its money** (ADR 20261012-incident-reports).
 * Owners and managers only, on the Reports gate. It reads what the shop
 * already records — roll calls, dock marks, card checks written past, crew
 * credentials, incident reports — over the departures that came back in the
 * month, and changes nothing.
 *
 * The month is walked the way Reports walks it: the same arrows and the same
 * picker, floored at the shop's first departure.
 */
export default async function SafetyReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { shopSlug } = await params;
  const { month } = await searchParams;
  // The Reports gate, re-read against the database; a refusal lands on Today
  // with its reason, as Reports' own does.
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopReports,
    refusal: { notice: "reports-not-authorized" },
  });
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
  const prevKey = compareMonths(current, floor) > 0 ? monthKey(addMonths(current, -1)) : null;
  const nextKey = isThisMonth ? null : monthKey(addMonths(current, 1));

  const { from, to } = shopMonthBounds(current, tz);
  const [safety, incidents] = await Promise.all([
    getSafetyMonth(db, shop.id, from, to, tz, now),
    listShopIncidentReports(db, shop.id, session.user.personId, from, to),
  ]);

  const lastDay = new Date(Date.UTC(current.year, current.month, 0)).getUTCDate();
  const activityHref = `${shopPath(shopSlug, "settings", "activity")}?kind=safety&from=${isoDate(current.year, current.month, 1)}&to=${isoDate(current.year, current.month, lastDay)}`;
  const figures: MonthFigure[] = [
    {
      key: "rollCalls",
      label: t("incidents.safety.rollCalls"),
      value: t("incidents.safety.rollCallsValue", {
        closed: safety.rollCallsClosed,
        back: safety.departuresBack,
      }),
      detail: t("incidents.safety.rollCallsDetail", { back: safety.departuresBack }),
      detailTone: safety.openRollCalls.length > 0 ? "attention" : "quiet",
    },
    {
      key: "boarded",
      label: t("incidents.safety.boarded"),
      value: String(safety.boardedAtDock),
      detail: t("incidents.safety.boardedDetail", { count: safety.unmarkedAtDock }),
      detailTone: safety.unmarkedAtDock > 0 ? "attention" : "quiet",
    },
    {
      key: "certOverrides",
      label: t("incidents.safety.certOverrides"),
      value: String(safety.certOverrides),
      link: { href: activityHref, label: t("incidents.safety.certOverridesLink") },
    },
    {
      key: "crew",
      label: t("incidents.safety.crew"),
      // A zero over crew with nothing on file is not a clean record: the
      // lapsed count judges only what was recorded, so the detail says how
      // much it could not judge, and a month with nothing on file at all
      // shows no ratio (third review, item 2).
      value:
        safety.crewSailings > 0 && safety.unrecordedSailings === safety.crewSailings
          ? t("incidents.safety.crewValueNoneOnFile")
          : t("incidents.safety.crewValue", {
              lapsed: safety.lapsedSailings.length,
              sailings: safety.crewSailings,
            }),
      detail:
        safety.unrecordedSailings > 0
          ? t("incidents.safety.crewDetailUnrecorded", {
              unrecorded: safety.unrecordedSailings,
              sailings: safety.crewSailings,
            })
          : t("incidents.safety.crewDetail", { sailings: safety.crewSailings }),
      detailTone:
        safety.lapsedSailings.length > 0 || safety.unrecordedSailings > 0 ? "attention" : "quiet",
    },
    {
      key: "incidents",
      label: t("incidents.safety.incidents"),
      value: String(incidents.length),
    },
  ];

  const navClass = buttonClass({ variant: "secondary", size: "icon" });
  const navDisabledClass = `${navClass} pointer-events-none opacity-40`;
  const safetyPath = shopPath(shopSlug, "reports", "safety");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader title={t("shared.shopSections.money")} />
      <StaffSectionTabs
        shopSlug={shopSlug}
        section="money"
        current="safety"
        roles={session.user.roles}
        t={t}
      />
      <p className="mb-6 max-w-prose text-muted">{t("incidents.safety.intro")}</p>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className={SECTION_TITLE_CLASS}>
          {monthLabel(current, locale)}
          {isThisMonth ? (
            <span className="ms-2 text-sm font-normal text-muted">{t("reports.soFar")}</span>
          ) : null}
        </h2>
        <nav aria-label={t("reports.chooseMonth")} className="flex flex-wrap items-center gap-2">
          {prevKey ? (
            <Link
              href={`${safetyPath}?month=${prevKey}`}
              aria-label={t("reports.previousMonth")}
              className={navClass}
              scroll={false}
            >
              <DiveDayIcon name="arrow-left" className="size-4" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              title={t("reports.earliestMonthTitle")}
              className={navDisabledClass}
            >
              <DiveDayIcon name="arrow-left" className="size-4" />
            </span>
          )}
          {nextKey ? (
            <Link
              href={`${safetyPath}?month=${nextKey}`}
              aria-label={t("reports.nextMonth")}
              className={navClass}
              scroll={false}
            >
              <DiveDayIcon name="arrow-right" className="size-4" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              title={t("reports.currentMonthTitle")}
              className={navDisabledClass}
            >
              <DiveDayIcon name="arrow-right" className="size-4" />
            </span>
          )}
        </nav>
      </div>

      {safety.departuresBack === 0 && incidents.length === 0 ? (
        <EmptyState title={t("incidents.safety.noDepartures")} />
      ) : (
        <div className="space-y-10">
          <div>
            <MonthFigures label={t("incidents.safety.figuresLabel")} figures={figures} />
            <p className="mt-3 max-w-prose text-sm text-muted">
              {t("incidents.safety.boardingNote")}
            </p>
          </div>
          <SafetyLists
            month={safety}
            incidents={incidents}
            credentialKindKeys={CREDENTIAL_KIND_KEYS}
            shopSlug={shopSlug}
            locale={locale}
            timeZone={tz}
            t={t}
          />
        </div>
      )}
    </main>
  );
}
