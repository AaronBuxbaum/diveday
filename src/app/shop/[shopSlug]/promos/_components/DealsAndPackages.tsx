import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Pager, staffPagerWords } from "@/components/Pager";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { TripDealLedger, type TripDealRow } from "./PromoLedger";

/**
 * **The last-minute deals this tab holds**, drawn only while the shop keeps
 * the last-minute list (the Features page).
 */
export function TripDealsSection({
  t,
  shopSlug,
  rows,
  page,
  href,
}: {
  t: StaffTranslator;
  shopSlug: string;
  rows: readonly TripDealRow[];
  page: { page: number; pageCount: number; total: number };
  href: (page: number) => string;
}) {
  return (
    <>
      {/* One heading over both branches — the list and its empty state stand
          under the same words, so neither renders a second spelling of them. */}
      <GroupLabel as="h2" id="trip-deals" className="mt-10">
        {t("promos.tripDeals.heading")}
      </GroupLabel>
      {rows.length === 0 ? (
        // A trip deal is sent from a departure, never from here, so the door is
        // the board. The one line saying so shows only here, where a reader
        // needs to know how to make one; a list of deals needs no caption.
        <>
          <p className="mt-1 text-sm text-muted">{t("promos.tripDeals.description")}</p>
          <EmptyState
            titleAs="h3"
            title={t("promos.tripDeals.empty")}
            action={
              <Link
                href={`/shop/${shopSlug}/schedule/board`}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("promos.tripDeals.emptyAction")}
              </Link>
            }
            className="mt-3"
          />
        </>
      ) : (
        <TripDealLedger className="mt-3" labelledBy="trip-deals" rows={rows} />
      )}
      <Pager
        page={page.page}
        pageCount={page.pageCount}
        href={href}
        total={t("promos.tripDeals.pagination.total", { count: page.total })}
        words={staffPagerWords(t)}
      />
    </>
  );
}

/**
 * **Prepaid packages are the third price this tab holds** (ADR
 * 20261001-logbook): set up once, so a door rather than a list. Drawn only
 * while the shop sells dive packages (the Features page).
 */
export function DivePackagesDoor({ t, shopSlug }: { t: StaffTranslator; shopSlug: string }) {
  return (
    <>
      <GroupLabel as="h2" id="dive-packages" className="mt-10">
        {t("settings.main.divePackages.heading")}
      </GroupLabel>
      <Link
        href={`/shop/${shopSlug}/promos/packages`}
        className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
      >
        {t("promos.packages.open")}
      </Link>
    </>
  );
}
