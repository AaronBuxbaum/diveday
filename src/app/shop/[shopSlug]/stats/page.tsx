import type { Metadata } from "next";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { groupLabelClass } from "@/components/ui/group-label";
import { requireShopSurface } from "@/features/accounts/session";
import { canPersonViewShopReports, readOwnerStats } from "@/features/reports/owner-stats";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { StaffSectionTabs } from "../_components/StaffSectionTabs";
import { MonthFigures } from "../reports/_components/MonthFigures";
import { statFigures, statsAreEmpty } from "./_components/stat-figures";

// Paints from its own `loading.tsx`, like the Reports page beside it.
export const instant = true;

export const metadata: Metadata = {
  title: "Stats — DiveDay",
};

/**
 * **The owner's stats** (issue #4262): repeat divers, the course funnel, how long medical reviews
 * take staff, waivers in by departure and departures with every waiver in the day before. Plain
 * aggregates over the last 12 months, read by `readOwnerStats`. Informational: nothing here gates
 * a boarding or messages a diver. The Reports gate, re-read against the database.
 */
export default async function StatsPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopReports,
    refusal: { notice: "reports-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const stats = await readOwnerStats(db, shop.id, { now: nowDate(), timeZone: shop.timezone });

  return (
    <StaffPage width="full">
      <ShopPageHeader title={t("shared.shopSections.money")} />
      <StaffSectionTabs
        section="money"
        current="ownerStats"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />
      {statsAreEmpty(stats) ? (
        <EmptyState title={t("stats.empty.title")} body={t("stats.empty.body")} />
      ) : (
        <div className="space-y-10">
          <div>
            <MonthFigures
              label={t("stats.figuresLabel")}
              figures={statFigures(stats, t)}
              columns={4}
            />
            <p className="mt-3 text-sm text-muted">{t("stats.basis")}</p>
          </div>
          <section aria-labelledby="stats-courses">
            <h2 id="stats-courses" className={groupLabelClass()}>
              {t("stats.courses.title")}
            </h2>
            {stats.courses.length === 0 ? (
              <p className="mt-3 text-muted">{t("stats.courses.empty")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {stats.courses.map((course) => (
                  <li
                    key={course.courseId}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3"
                  >
                    <span className="font-medium">{course.title}</span>
                    <span className="text-muted tabular-nums">
                      {t("stats.courses.asked", { count: course.asked })}
                      {" · "}
                      {t("stats.courses.booked", { count: course.booked })}
                      {" · "}
                      {t("stats.courses.certified", { count: course.certified })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </StaffPage>
  );
}
