import type { Metadata } from "next";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { EXPORT_DATASETS } from "@/lib/export";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Export your data — DiveDay" };

/**
 * The exit door, kept visibly unlocked. One button downloads everything the
 * shop owns as documented CSVs — the "leave anytime" guarantee from the
 * portability wedge (docs/product/competitive-strategy.md). Owner/manager
 * only: the bundle carries diver PII and medical evidence.
 */
export default async function ExportSettingsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const canExport = session.user.roles.includes("owner") || session.user.roles.includes("manager");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow="Settings"
        title="Export your data"
        description="Everything your shop owns, as plain CSV files anyone can open — divers, certifications, waivers with their signed text, trips, bookings, payments, and the full roll-call history."
      />

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">One bundle, no asking us first</h2>
        <p className="mt-1 text-sm text-muted">
          The download is a ZIP of {EXPORT_DATASETS.length} CSV files plus a README that documents
          every column. Timestamps are ISO 8601, money is in cents, and ids join across files —
          ready for a spreadsheet, an accountant, or another system. Your data is yours: export it
          as often as you like, and take it with you if you ever leave.
        </p>
        {canExport ? (
          <a
            href={`/shop/${shopSlug}/settings/export/download`}
            download
            className={buttonClass({ className: "mt-4" })}
          >
            Download everything
          </a>
        ) : (
          <div className="mt-4">
            <ShopNotice tone="warning" role="status">
              The full export includes divers' contact details and medical answers, so only an owner
              or manager can download it. Ask yours — it's one button.
            </ShopNotice>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">What's in the bundle</h2>
        <ul className="mt-3 divide-y divide-border">
          {EXPORT_DATASETS.map((dataset) => (
            <li key={dataset.filename} className="py-2.5 text-sm">
              <span className="font-mono text-xs">{dataset.filename}</span>
              <p className="mt-0.5 text-muted">{dataset.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">What stays out, on purpose</h2>
        <p className="mt-1 text-sm text-muted">
          Login passwords (hashes belong to no one — people set new ones wherever they land), waiver
          signing-link secrets, and notification delivery logs. Card photos and site images are
          linked by durable URL in the CSVs rather than embedded, so the bundle stays small enough
          to email.
        </p>
      </section>
    </main>
  );
}
