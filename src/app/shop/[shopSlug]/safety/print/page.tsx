import type { Metadata } from "next";
import { CREDENTIAL_KIND_KEYS } from "@/app/shop/[shopSlug]/settings/team/credential-kinds";
import { canPersonViewShopReports } from "@/features/safety-report";
import { requireShopSurface } from "@/features/session";
import { monthKey, monthLabel } from "@/lib/calendar";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { SheetDocument } from "../../print/_components/SheetDocument";
import { sheetPrinted } from "../../print/_components/ShopSheet";
import { MonthFigures } from "../../reports/_components/MonthFigures";
import { PacketSheet } from "../../trips/[id]/_components/packet/TripPacket";
import { DrillLog } from "../_components/DrillLog";
import { readDrillLog } from "../_components/drill-log-read";
import { SafetyLists } from "../_components/SafetyLists";
import { readSafetyReport } from "../_components/safety-read";

export const instant = true;

export const metadata: Metadata = {
  title: "Safety record — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The Safety record as a sheet** (issue #2745): the month, or the year the
 * insurer renews on, printed from the Safety screen's Print door for the
 * period that screen shows (`?month=` / `?year=`, the same grammar and the
 * same Reports gate). It reads what the screen reads (`readSafetyReport`) and
 * is one `PaperSheet` behind `SheetDocument`: the shop's band, whose record it
 * is over which days in which zone, every figure and, for a month, every list
 * behind them. The figures lose their doors and the lists their links,
 * because a link does nothing on paper.
 */
export default async function SafetyPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const { shopSlug } = await params;
  const { month, year: yearParam } = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopReports,
    refusal: { notice: "reports-not-authorized" },
  });
  const report = await readSafetyReport({ shopSlug, session, db, shop, month, year: yearParam });
  const { t, locale, tz, year, current, safety, incidents, now } = report;
  const drills = await readDrillLog({
    db,
    shopId: shop.id,
    timeZone: tz,
    month: year ? null : current,
    locale,
    t,
  });
  const safetyPath = shopPath(shopSlug, "safety");
  const period = year ? `year=${year.number}` : `month=${monthKey(current)}`;
  const empty = safety.departuresBack === 0 && incidents.length === 0;
  // Doors and links are the screen's; the sheet keeps the words.
  const bare = <F extends { href?: string; link?: unknown }>(figures: F[]) =>
    figures.map(({ href: _href, link: _link, ...figure }) => figure);

  return (
    <SheetDocument
      backHref={`${safetyPath}?${period}`}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("shared.shopSections.safety")}
      printLabel={t("print.sheet.door")}
    >
      <PacketSheet
        shop={{ name: shop.name, brandColor: shop.brandColor }}
        shopSlug={shopSlug}
        name={t("shared.shopSections.safety")}
        printed={sheetPrinted(t, now, locale, tz, session.user.name)}
      >
        <div className="mb-4 text-sm">
          <p className="font-medium">{report.printedFor}</p>
          <p>{t("incidents.safety.year.printedOn", { date: report.printedOn })}</p>
        </div>
        <h1 className="mb-4 font-brand-display text-xl font-extrabold tabular-nums">
          {year ? String(year.number) : monthLabel(current, locale)}
        </h1>
        {empty ? (
          <p className="text-sm">
            {t(year ? "incidents.safety.year.noDepartures" : "incidents.safety.noDepartures")}
          </p>
        ) : year ? (
          <MonthFigures
            label={t("incidents.safety.year.figuresLabel")}
            figures={bare(report.figures)}
          />
        ) : (
          <div className="space-y-6">
            <MonthFigures
              label={t("incidents.safety.figuresLabel")}
              figures={bare(report.monthTiles)}
              columns={4}
            />
            <SafetyLists
              paper
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
        <div className="mt-6">
          <DrillLog view={drills} paper />
        </div>
      </PacketSheet>
    </SheetDocument>
  );
}
