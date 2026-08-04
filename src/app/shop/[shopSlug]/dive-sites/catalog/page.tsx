import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { importGlobalDiveSiteTemplate, listGlobalDiveSiteTemplates } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

// Without this the tab falls all the way back to the root layout's marketing
// title ("DiveDay — a calmer way to run a dive day"), which is what every other
// staff page sets its own title to avoid.
export const metadata: Metadata = { title: "Common dive sites — DiveDay" };

// Not a TODO. The shop layout above already permits this route's blocking
// prerender (`isPageAllowedToBlock` reads only the outermost `instant`), so what
// this line still buys is keeping the page segment out of dev-time instant
// validation — which nothing above a page segment can do.
// See ADR 20260803-instant-opt-out-placement.
export const instant = false;

export default async function CommonDiveSitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { page } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range so a bookmarked page past the end lands on the last real one.
  const catalog = await listGlobalDiveSiteTemplates(db, { page: Number.parseInt(page ?? "", 10) });
  const back = `/shop/${shopSlug}/dive-sites`;
  const self = `${back}/catalog`;
  const pageHref = (target: number) => (target > 1 ? `${self}?page=${target}` : self);
  async function importAction(formData: FormData) {
    "use server";
    const active = await requireStaffSession();
    const id = String(formData.get("templateId") ?? "");
    const site = await importGlobalDiveSiteTemplate(await getDb(), active.user.shopId, id);
    if (!site) redirect(back);
    revalidateAndRedirect(back, `${back}/${site.id}?notice=imported`);
  }
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        {t("diveSites.backToLibrary")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={t("diveSites.catalogEyebrow")}
          title={t("diveSites.catalog.title")}
          description={t("diveSites.catalog.description")}
        />
      </div>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {catalog.templates.map(({ template, version }) => (
          <li key={template.id} className="rounded-lg border border-border bg-surface p-5">
            <p className="text-sm font-medium text-primary">
              {t("diveSites.catalog.templateVersion", { version: version.version })}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{version.briefing.name}</h2>
            <p className="mt-2 text-sm text-muted">{version.briefing.description}</p>
            <form action={importAction} className="mt-5">
              <input type="hidden" name="templateId" value={template.id} />
              <SubmitButton
                pendingLabel={t("diveSites.catalog.importing")}
                className={buttonClass()}
              >
                {t("diveSites.catalog.importToLibrary")}
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
      <Pager
        page={catalog.page}
        pageCount={catalog.pageCount}
        href={pageHref}
        total={t("diveSites.catalog.pagination.total", { count: catalog.total })}
        t={t}
        className="mt-6"
      />
    </main>
  );
}
