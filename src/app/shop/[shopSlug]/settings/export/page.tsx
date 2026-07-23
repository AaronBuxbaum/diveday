import type { Metadata } from "next";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { loadShopExportCounts } from "@/db/export";
import { canExportShopData } from "@/lib/authz";
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

  if (!canExportShopData(session.user.roles)) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader
          eyebrow="Settings"
          title="Data export"
          description="Download everything this shop keeps in DiveDay as plain CSV files."
        />
        <ShopNotice tone="warning" role="status">
          The full export includes every diver's contact details and signed medical forms, so it's
          limited to the shop's owner or manager. Ask them to run it if you need a copy.
        </ShopNotice>
      </main>
    );
  }

  const db = await getDb();
  const families = await loadShopExportCounts(db, session.user.shopId);
  if (!families) return null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow="Settings"
        title="Data export"
        description="Download everything this shop keeps in DiveDay as plain CSV files — divers, cards, trips, bookings, signed waivers, rental sizes, orders, wait lists, dive sites, and courses. Yours to keep, on every plan, whenever you want it — including a ready-to-import contacts file another system's import wizard can map directly."
        actions={
          <DownloadExportButton href={`/shop/${session.user.shopSlug}/settings/export/download`} />
        }
      />

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">What's in the bundle</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          One ZIP with a README and a CSV for each kind of record. Every date and time carries its
          timezone, money is in cents, and your archived history comes along too — nothing is lost
          if you ever move on.
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
                {family.count === 1 ? "1 row" : `${family.count} rows`}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">
          <span className="font-medium text-foreground">Not included, on purpose:</span> offline
          manifest snapshots, notification logs, Stripe checkout attempts (every money outcome is in
          the bookings and orders files), and card images — the CSVs carry each card's stored image
          reference, which stays readable while this account is active, so save copies before ever
          closing it. Sign-in credentials are never exported. The bundle's README lists the same
          gaps.
        </p>
      </section>
    </main>
  );
}
