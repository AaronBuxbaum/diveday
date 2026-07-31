import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { canPersonExportShopData, loadShopExportCounts } from "@/db/export";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireStaffSession } from "@/lib/session";
import { DownloadExportButton } from "./DownloadExportButton";

export const metadata: Metadata = { title: "Data export — DiveDay" };

/**
 * The "leave anytime" surface (ADR 20260722-full-shop-export): one button, the
 * whole shop as documented CSVs. The list below comes from the same file
 * definitions as the bundle's README, so what we promise on screen is exactly
 * what the ZIP contains — but only row counts are queried here, never the rows.
 */
export default async function DataExportPage() {
  const session = await requireStaffSession();
  const db = await getDb();

  // Checked against the database, not the JWT — see the download route.
  // Bounced to Today with an explanatory notice rather than teleporting
  // silently (task 82, UX persona 11 "Kai") — Today already renders
  // `shopHome.notice.*` codes.
  if (!(await canPersonExportShopData(db, session.user.shopId, session.user.personId))) {
    redirect(`/shop/${session.user.shopSlug}?notice=export_not_authorized`);
  }

  const families = await loadShopExportCounts(db, session.user.shopId);
  if (!families) return null;

  const shop = await getShopById(db, session.user.shopId);
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("settings.export.eyebrow")}
        title={t("settings.export.title")}
        description={t("settings.export.description")}
        actions={
          <>
            <Link
              href={`/shop/${session.user.shopSlug}/settings`}
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              {t("settings.main.backToSettings")}
            </Link>
            <DownloadExportButton
              href={`/shop/${session.user.shopSlug}/settings/export/download`}
              idleLabel={t("settings.export.downloadButton.idle")}
              acknowledgedLabel={t("settings.export.downloadButton.acknowledged")}
            />
          </>
        }
      />

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">{t("settings.export.bundle.heading")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("settings.export.bundle.description")}
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {families.map((family) => (
            <li
              key={family.file}
              className="flex items-baseline justify-between gap-3 rounded-xl bg-surface-sunken px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-mono text-sm break-all text-foreground">{family.file}</p>
                <p className="mt-0.5 text-xs text-muted">{family.note}</p>
              </div>
              <span className="shrink-0 text-xs font-medium text-muted tabular-nums">
                {t("settings.export.rowCount", { count: family.count })}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">
          <span className="font-medium text-foreground">
            {t("settings.export.notIncluded.label")}
          </span>{" "}
          {t.rich("settings.export.notIncluded.text", {
            mono: (chunks) => <code>{chunks}</code>,
          })}
        </p>
      </section>
    </main>
  );
}
