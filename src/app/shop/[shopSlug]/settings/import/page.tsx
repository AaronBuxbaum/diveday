import type { Metadata } from "next";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { canPersonImportShopData } from "@/db/import";
import { IMPORT_HONESTY_TABLE } from "@/lib/import";
import { requireStaffSession } from "@/lib/session";
import { ImportWizard } from "./ImportWizard";

export const metadata: Metadata = { title: "Import contacts — DiveDay" };

const scopeChip: Record<
  (typeof IMPORT_HONESTY_TABLE)[number]["scope"],
  { label: string; className: string }
> = {
  full: { label: "Imports fully", className: "bg-success/10 text-success" },
  partial: { label: "Partial", className: "bg-warning/15 text-foreground" },
  never: { label: "Never", className: "bg-danger/10 text-danger" },
};

/**
 * The intake side of the portability wedge (ADR 20260723-contact-importer):
 * bring a shop's people, cards, and sizes in from a CSV — and say plainly, up
 * front, what does and doesn't come across. Gated to owner/manager like the
 * export, and re-checked against the database in the commit action.
 */
export default async function ImportContactsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();

  if (!(await canPersonImportShopData(db, session.user.shopId, session.user.personId))) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader
          eyebrow="Settings"
          title="Import contacts"
          description="Bring your divers, cards, and rental sizes in from a CSV."
        />
        <ShopNotice tone="warning">
          Importing writes to the whole roster, so it's limited to the shop's owner or manager. Ask
          them to run it if you have a file to bring in.
        </ShopNotice>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow="Settings"
        title="Import contacts"
        description="Bring your divers, cards, and rental sizes in from a CSV — from your old system or from DiveDay's own export. We're honest about what comes across: imported cards land as claims your staff verify, and medical history never migrates."
      />

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">What comes across</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          The safety spine holds through an import. Nothing arrives verified, and nothing medical
          arrives at all.
        </p>
        <ul className="mt-4 space-y-2">
          {IMPORT_HONESTY_TABLE.map((row) => (
            <li
              key={row.what}
              className="grid gap-1 rounded-xl bg-surface-sunken px-4 py-3 sm:grid-cols-[10rem_7rem_1fr] sm:items-baseline sm:gap-3"
            >
              <span className="font-medium text-foreground">{row.what}</span>
              <span>
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${scopeChip[row.scope].className}`}
                >
                  {scopeChip[row.scope].label}
                </span>
              </span>
              <span className="text-sm text-muted">{row.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6">
        <ImportWizard diversHref={`/shop/${shopSlug}/divers`} />
      </div>
    </main>
  );
}
