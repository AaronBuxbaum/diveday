import type { Metadata } from "next";
import Link from "next/link";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { CREDENTIAL_KIND_KEYS } from "@/app/shop/[shopSlug]/settings/team/credential-kinds";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { canPersonViewShopReports } from "@/db/safety-report";
import { monthKey, monthLabel } from "@/lib/calendar";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { MonthFigures } from "../reports/_components/MonthFigures";
import { SafetyLists } from "./_components/SafetyLists";
import { readSafetyReport } from "./_components/safety-read";

// Paints from its own `loading.tsx`, like Reports (ADR 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = {
  title: "Safety — DiveDay",
};

/** Safety records over the departures that came home in the chosen month or year. */
export default async function SafetyReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const { shopSlug } = await params;
  const { month, year: yearParam } = await searchParams;
  // The Reports gate, re-read against the database; a refusal lands on Today
  // with its reason, as Reports' own does.
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopReports,
    refusal: { notice: "reports-not-authorized" },
  });
  const {
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
  } = await readSafetyReport({ shopSlug, session, db, shop, month, year: yearParam });

  const navClass = buttonClass({ variant: "secondary", size: "icon" });
  const navDisabledClass = `${navClass} pointer-events-none opacity-40`;
  const safetyPath = shopPath(shopSlug, "safety");

  return (
    <StaffPage width="full">
      <ShopPageHeader
        title={t("shared.shopSections.safety")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={
                year
                  ? `${safetyPath}?month=${monthKey(current)}`
                  : `${safetyPath}?year=${current.year}`
              }
              className={buttonClass({ variant: "secondary" })}
            >
              {t(year ? "incidents.safety.monthView" : "incidents.safety.year.open")}
            </Link>
            <Link
              href={`${shopPath(shopSlug, "safety", "print")}?${year ? `year=${year.number}` : `month=${monthKey(current)}`}`}
              className={buttonClass({ variant: "secondary" })}
            >
              {t(year ? "incidents.safety.year.print" : "incidents.safety.printMonth")}
            </Link>
          </div>
        }
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className={SECTION_TITLE_CLASS}>
          {year ? String(year.number) : monthLabel(current, locale)}
          {(year ? year.isThisYear : isThisMonth) ? (
            <span className="ms-2 text-sm font-normal text-muted">{t("reports.soFar")}</span>
          ) : null}
        </h2>
        <nav
          aria-label={t(year ? "incidents.safety.year.chooseYear" : "reports.chooseMonth")}
          className="flex flex-wrap items-center gap-2"
        >
          {prevKey ? (
            <Link
              href={`${safetyPath}?${prevKey}`}
              aria-label={t(year ? "incidents.safety.year.previous" : "reports.previousMonth")}
              className={navClass}
              scroll={false}
            >
              <DiveDayIcon name="arrow-left" className="size-4" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              title={t(year ? "incidents.safety.year.earliestTitle" : "reports.earliestMonthTitle")}
              className={navDisabledClass}
            >
              <DiveDayIcon name="arrow-left" className="size-4" />
            </span>
          )}
          {nextKey ? (
            <Link
              href={`${safetyPath}?${nextKey}`}
              aria-label={t(year ? "incidents.safety.year.next" : "reports.nextMonth")}
              className={navClass}
              scroll={false}
            >
              <DiveDayIcon name="arrow-right" className="size-4" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              title={t(year ? "incidents.safety.year.currentTitle" : "reports.currentMonthTitle")}
              className={navDisabledClass}
            >
              <DiveDayIcon name="arrow-right" className="size-4" />
            </span>
          )}
        </nav>
      </div>

      {safety.departuresBack === 0 && incidents.length === 0 ? (
        <EmptyState
          title={t(year ? "incidents.safety.year.noDepartures" : "incidents.safety.noDepartures")}
        />
      ) : year ? (
        // The year is the figures alone: the lists behind them stay on each
        // month. This is the page printed for a third party.
        <MonthFigures label={t("incidents.safety.year.figuresLabel")} figures={figures} />
      ) : (
        <div className="space-y-10">
          <MonthFigures
            label={t("incidents.safety.figuresLabel")}
            figures={monthTiles}
            columns={4}
          />
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
    </StaffPage>
  );
}
