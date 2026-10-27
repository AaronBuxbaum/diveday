import Link from "next/link";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { EmptyState } from "@/components/EmptyState";
import { Pager, staffPagerWords } from "@/components/Pager";
import { RowMenu } from "@/components/RowMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow } from "@/components/ui/ledger";
import { menuRowClass } from "@/components/ui/menu";
import type { AppDb } from "@/db/client";
import { listDivePackages } from "@/db/dive-packages";
import { packageDivesOwedAt } from "@/db/report-lines";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { MAX_PACKAGE_DIVE_COUNT } from "@/lib/dive-packages";
import { formatMoneyScanned } from "@/lib/format";
import { noticeFromParam } from "@/lib/staff-notices";
import { createDivePackageAction, deleteDivePackageAction } from "../../settings/package-actions";
import { divePackageNoticeMessages } from "../../settings/sub-page-notices";
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
 * 20261001-logbook), listed here rather than behind a door (visual review
 * 2026-10-24, A26): a row per package (name, dives, price, scope) ending on
 * one "⋯" that holds its Delete (a red word wrapped under each row at 390), what the shop still owes in dives, and "Add a package" opening the
 * form. `/promos/packages` redirects here. Packages have no edit: a package is
 * a price already sold against, so a change is a new package and a Delete.
 * Drawn only while the shop sells dive packages (the Features page).
 */
export async function DivePackagesSection({
  db,
  shop,
  t,
  notice,
  locale,
}: {
  db: AppDb;
  shop: { id: string; currency: string };
  t: StaffTranslator;
  /** The page's `?notice=`; a package save or delete answers beside the list it changed. */
  notice: string | undefined;
  locale: string;
}) {
  // What the shop still owes in dives (fourth UX review, item 20): sold, not
  // yet taken, at what each was bought for. The month report's figure, at now.
  const [packages, owed] = await Promise.all([
    listDivePackages(db, shop.id),
    packageDivesOwedAt(db, shop.id, nowDate()),
  ]);
  const currency = shop.currency;
  const status = noticeFromParam(notice, divePackageNoticeMessages(t));
  return (
    <section aria-labelledby="dive-packages" className="mt-10 scroll-mt-24">
      <GroupLabel as="h2" id="dive-packages">
        {t("settings.main.divePackages.heading")}
      </GroupLabel>
      {status ? (
        <FormStatus tone={status.tone} className="mt-2">
          {status.text}
        </FormStatus>
      ) : null}
      {owed.dives > 0 ? (
        <p className="mt-2 text-sm tabular-nums text-muted">
          {t("settings.main.divePackages.owed", {
            dives: owed.dives,
            value: formatMoneyScanned(owed.valueCents, currency, locale),
          })}
        </p>
      ) : null}
      {packages.length > 0 ? (
        <ul className="mt-3" aria-labelledby="dive-packages">
          {packages.map((pkg) => (
            <LedgerRow
              key={pkg.id}
              trailing={
                <RowMenu label={t("settings.main.divePackages.rowMenu", { name: pkg.name })}>
                  <form action={deleteDivePackageAction}>
                    <input type="hidden" name="packageId" value={pkg.id} />
                    <SubmitButton
                      pendingLabel={t("settings.main.divePackages.deleting")}
                      className={menuRowClass("danger", { gutter: false })}
                    >
                      {t("settings.main.divePackages.delete")}
                    </SubmitButton>
                  </form>
                </RowMenu>
              }
            >
              <span className="block min-w-0">
                <span className="font-medium">{pkg.name}</span>{" "}
                <span className="text-base text-muted tabular-nums">
                  {t("settings.main.divePackages.summary", {
                    dives: pkg.diveCount,
                    price: formatMoneyScanned(pkg.priceCents, currency, locale),
                    scope: t(
                      pkg.scope === "fun_dives"
                        ? "settings.main.divePackages.scopeFunDives"
                        : "settings.main.divePackages.scopeAll",
                    ),
                  })}
                </span>
              </span>
            </LedgerRow>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">{t("settings.main.divePackages.empty")}</p>
      )}
      <AutoOpenDetails
        id="package-new"
        openOnHash="package-new"
        open={notice === "package-invalid"}
        className="group/package mt-4 scroll-mt-24 print:[&:not([open])]:hidden"
      >
        <summary
          className={`${buttonClass({ variant: "secondary", size: "sm" })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          {t("settings.main.divePackages.createTitle")}
        </summary>
        <FieldGrid as="form" action={createDivePackageAction} columns={2} className="mt-4">
          <Field label={t("settings.main.divePackages.nameLabel")}>
            <input name="name" required maxLength={80} className={controlClass} />
          </Field>
          <Field label={t("settings.main.divePackages.diveCountLabel")}>
            <input
              name="diveCount"
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={MAX_PACKAGE_DIVE_COUNT}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
          <Field label={t("settings.main.divePackages.priceLabel")}>
            <input
              name="priceDollars"
              type="number"
              inputMode="decimal"
              required
              min={1}
              step="0.01"
              className={`${controlClass} tabular-nums`}
            />
          </Field>
          <Field
            label={t("settings.main.divePackages.validityLabel")}
            description={t("settings.main.divePackages.validityDescription")}
          >
            <DateField name="validUntil" className="tabular-nums" />
          </Field>
          <Field label={t("settings.main.divePackages.scopeLabel")}>
            <select name="scope" defaultValue="fun_dives" className={controlClass}>
              <option value="all">{t("settings.main.divePackages.scopeAll")}</option>
              <option value="fun_dives">{t("settings.main.divePackages.scopeFunDives")}</option>
            </select>
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("settings.main.divePackages.submitting")}
              className={buttonClass()}
            >
              {t("settings.main.divePackages.submit")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </AutoOpenDetails>
    </section>
  );
}
