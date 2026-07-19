import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { listDiveSites, listGlobalDiveSiteTemplates } from "@/db/dive-sites";
import { getShopById } from "@/db/queries";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dive sites — Scuba" };

export default async function DiveSitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const [sites, templates] = await Promise.all([
    listDiveSites(db, shop.id),
    listGlobalDiveSiteTemplates(db),
  ]);
  const currentTemplateVersion = new Map(
    templates.map(({ template, version }) => [template.id, version.version]),
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        backHref={`/shop/${shopSlug}`}
        title="Dive-site library"
        description="Build the briefing once, then attach it to any charter. Copy a site before tailoring a special itinerary."
        actions={
          <>
            <Link
              href={`/shop/${shopSlug}/dive-sites/new`}
              className="min-h-11 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              <span aria-hidden="true">+</span> Create a site
            </Link>
            <Link
              href={`/shop/${shopSlug}/dive-sites/catalog`}
              className="min-h-11 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-surface-sunken"
            >
              Browse templates
            </Link>
          </>
        }
      />

      <section aria-label="Dive-site snapshot" className="mb-8 grid gap-3 sm:grid-cols-3">
        <ShopStat
          label="Saved sites"
          value={sites.length}
          detail="Reusable crew briefings"
          tone="primary"
        />
        <ShopStat
          label="With forecast points"
          value={
            sites.filter(
              (site) => site.forecastLatitude !== null && site.forecastLongitude !== null,
            ).length
          }
          detail="Ready for marine outlooks"
          tone="success"
        />
        <ShopStat
          label="From templates"
          value={sites.filter((site) => site.sourceTemplateId).length}
          detail="Imported and tailored locally"
        />
      </section>

      {notice === "archived" ? (
        <ShopNotice>Site archived. Historical trip briefings are still preserved.</ShopNotice>
      ) : null}

      {sites.length === 0 ? (
        <section className="mt-4 rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <h2 className="font-semibold">Start with a site your crew knows well</h2>
          <p className="mt-1 text-sm text-muted">
            Add a location, a map or route image, and the life divers may encounter.
          </p>
        </section>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                href={`/shop/${shopSlug}/dive-sites/${site.id}`}
                className="group block h-full rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface-sunken"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold group-hover:text-primary">{site.name}</h2>
                  <span
                    aria-hidden="true"
                    className="text-primary transition-transform group-hover:translate-x-1"
                  >
                    →
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{site.locationName ?? "Location to add"}</p>
                {site.sourceTemplateVersion ? (
                  <p className="mt-2 text-xs font-medium text-primary">
                    {(currentTemplateVersion.get(site.sourceTemplateId ?? "") ?? 0) >
                    site.sourceTemplateVersion
                      ? `Template update v${currentTemplateVersion.get(site.sourceTemplateId ?? "") ?? ""} ready — your edits are safe.`
                      : `Scuba template v${site.sourceTemplateVersion}`}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  {site.minimumCertificationLevel ? (
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-primary">
                      {site.minimumCertificationLevel.replaceAll("_", " ")}
                    </span>
                  ) : null}
                  {site.requiresNitrox ? (
                    <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning">
                      Nitrox
                    </span>
                  ) : null}
                  {site.requiredSpecialties.length > 0 ? (
                    <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-muted">
                      {site.requiredSpecialties.length} specialty gate
                      {site.requiredSpecialties.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                <p className="mt-4 line-clamp-2 text-sm text-muted">
                  {site.marineLife || site.description || "Add the briefing your divers will see."}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
