import type { Metadata } from "next";
import Link from "next/link";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { listShopNitroxFills } from "@/db/nitrox";
import { getShopById } from "@/db/queries";
import { formatShortDate } from "@/lib/format";
import { nitroxMixLabel, ppO2CentibarToBar } from "@/lib/nitrox";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Nitrox fills — Scuba" };

export default async function NitroxPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const fills = await listShopNitroxFills(db, shop.id);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={shop.name}
        title="Nitrox fills"
        description="Review analyzed EANx fills across trips. Nitrox cards are managed with every diver’s other certification cards."
        actions={
          <Link
            href={`/shop/${shopSlug}/divers`}
            className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-primary hover:bg-surface-sunken"
          >
            Open diver cards
          </Link>
        }
      />
      <div className="rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm">
        <strong>Verified card required.</strong>{" "}
        <span className="text-muted">
          The fill and gear handoff flow stays locked until the diver’s Nitrox card is verified.
        </span>
      </div>
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Recent fills</h2>
        {fills.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border-strong bg-surface p-6 text-sm text-muted">
            No fills logged yet. Open a trip and log an analyzed fill from its Nitrox fills page.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
            {fills.map(({ fill, person, tank, trip }) => (
              <li
                key={fill.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {person.fullName} · {nitroxMixLabel(fill.oxygenPercent)}
                  </p>
                  <p className="text-sm text-muted">
                    {tank.label} · {trip.title} · {formatShortDate(fill.analyzedAt, "en-US")}
                  </p>
                </div>
                <span className="shrink-0 self-start rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums sm:self-auto">
                  MOD {fill.maxDepthMeters} m @ ppO₂ {ppO2CentibarToBar(fill.maxPpO2Centibar)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
