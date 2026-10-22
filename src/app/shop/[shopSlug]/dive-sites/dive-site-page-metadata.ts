import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDiveSite, getGlobalDiveSiteTemplate } from "@/db/dive-sites";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { uuidParam } from "@/lib/uuid";

export async function catalogPageMetadata(
  shopSlug: string,
  search: { view?: string; template?: string },
): Promise<Metadata> {
  const { db, shop } = await requireShopSurface(shopSlug);
  if (search.view === "catalog" && search.template?.trim()) {
    const site = await getGlobalDiveSiteTemplate(db, search.template.trim(), shop);
    if (site) return { title: `${site.version.briefing.name} — DiveDay` };
  }
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  return { title: `${t(STAFF_DESTINATION_LABEL_KEYS.diveSites)} — DiveDay` };
}

export async function librarySitePageMetadata(shopSlug: string, id: string): Promise<Metadata> {
  if (!uuidParam(id)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  const site = await getDiveSite(db, shop.id, id);
  if (!site) notFound();
  return { title: `${site.name} — DiveDay` };
}

export async function librarySiteRouteMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}): Promise<Metadata> {
  const { shopSlug, id } = await params;
  return librarySitePageMetadata(shopSlug, id);
}
