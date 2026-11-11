import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatCalendarDateRange, formatTimeZoneGeneric } from "@/lib/format";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { WEEK_PARAM } from "@/lib/week-board";
import { SheetDocument } from "../../print/_components/SheetDocument";
import { sheetAttribution } from "../../print/_components/ShopSheet";
import { formatPaperDateTime } from "../../trips/[id]/_components/DeparturePaperIdentity";
import { PacketSheet } from "../../trips/[id]/_components/packet/TripPacket";
import { staffingGapWords } from "../_components/gap-words";
import { StaffingRotaSheet } from "../_components/StaffingRotaSheet";
import { readStaffingWeek } from "../_components/staffing-week-read";
import { staffingWeekWords } from "../_components/staffing-week-words";

export const instant = true;

export const metadata: Metadata = {
  title: "Crew rota — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The crew week as a sheet** (issue #2745): the rota a shop pins to its
 * noticeboard, printed from the Crew screen's Print door for the week that
 * screen shows (`?week=`, the same grammar). It reads what the screen reads
 * (`readStaffingWeek`) and is one `PaperSheet` behind `SheetDocument`, as
 * every printed document is: the shop's band, the rota, and the fold line
 * saying when it was printed and in which zone, because a rota on a board
 * outlives the week it was printed in.
 */
export default async function StaffingPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { shopSlug } = await params;
  const query = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  // The Crew view's own answer for a shop that keeps no crew schedule.
  if (!shop.crewScheduleEnabled) redirect(shopPath(shopSlug, "schedule", "board"));
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const read = await readStaffingWeek({ db, shop, session, week: query[WEEK_PARAM], t });
  if (!read) redirect(shopPath(shopSlug, "staffing", "print"));
  const { weekStart, weekEnd, view, week } = read;
  const rangeLabel = formatCalendarDateRange(weekStart, weekEnd, locale);
  const printed = `${sheetAttribution(t, formatPaperDateTime(nowDate(), locale, shop.timezone), session.user.name)} · ${shop.timezone}`;

  return (
    <SheetDocument
      backHref={`${shopPath(shopSlug, "staffing")}?${WEEK_PARAM}=${weekStart}`}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("schedule.views.crew")}
      printLabel={t("print.sheet.door")}
    >
      <PacketSheet
        shop={{ name: shop.name, brandColor: shop.brandColor }}
        shopSlug={shopSlug}
        name={t("schedule.views.crew")}
        printed={printed}
      >
        <h1 className="mb-4 font-brand-display text-xl font-extrabold tabular-nums">
          {rangeLabel}
        </h1>
        {view.staff.length === 0 ? (
          <p className="text-sm">{t("staffing.working.rosterEmptyHeading")}</p>
        ) : (
          <StaffingRotaSheet
            week={week}
            gapWords={staffingGapWords(t)}
            words={staffingWeekWords(t, week)}
            locale={locale}
            timeZone={shop.timezone}
            shopName={shop.name}
            rangeLabel={rangeLabel}
            timeZoneLabel={formatTimeZoneGeneric(locale, shop.timezone)}
          />
        )}
      </PacketSheet>
    </SheetDocument>
  );
}
