import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { listDiveSites, listGlobalDiveSiteTemplates } from "@/db/dive-sites";
import { getShopById } from "@/db/queries";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dive sites — Scuba" };

export default async function DiveSitesPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
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
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <Link href={`/shop/${shopSlug}`} className="text-sm font-medium text-primary hover:underline">
        ← Back to the shop
      </Link>
      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dive-site library</h1>
          <p className="mt-1 max-w-xl text-muted">
            Build the briefing once, then attach it to any charter. Copy a site before tailoring a
            special itinerary.
          </p>
        </div>
        <Link
          href={`/shop/${shopSlug}/dive-sites/new`}
          className="min-h-11 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
        >
          Create a site
        </Link>
        <Link
          href={`/shop/${shopSlug}/dive-sites/catalog`}
          className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium"
        >
          Browse Scuba templates
        </Link>
      </header>

      {sites.length === 0 ? (
        <section className="mt-10 rounded-lg border border-border bg-surface p-10 text-center">
          <h2 className="font-semibold">Start with a site your crew knows well</h2>
          <p className="mt-1 text-sm text-muted">
            Add a location, a map or route image, and the life divers may encounter.
          </p>
        </section>
      ) : (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                href={`/shop/${shopSlug}/dive-sites/${site.id}`}
                className="block h-full rounded-lg border border-border bg-surface p-5 transition-colors duration-200 hover:border-primary/40"
              >
                <h2 className="font-semibold">{site.name}</h2>
                <p className="mt-1 text-sm text-muted">{site.locationName ?? "Location to add"}</p>
                {site.sourceTemplateVersion ? (
                  <p className="mt-2 text-xs font-medium text-primary">
                    {(currentTemplateVersion.get(site.sourceTemplateId ?? "") ?? 0) >
                    site.sourceTemplateVersion
                      ? `Template update v${currentTemplateVersion.get(site.sourceTemplateId ?? "") ?? ""} ready — your edits are safe.`
                      : `Scuba template v${site.sourceTemplateVersion}`}
                  </p>
                ) : null}
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
