import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { importGlobalDiveSiteTemplate, listGlobalDiveSiteTemplates } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

export default async function CommonDiveSitesPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const templates = await listGlobalDiveSiteTemplates(db);
  const back = `/shop/${shopSlug}/dive-sites`;
  async function importAction(formData: FormData) {
    "use server";
    const active = await requireStaffSession();
    const id = String(formData.get("templateId") ?? "");
    const site = await importGlobalDiveSiteTemplate(await getDb(), active.user.shopId, id);
    if (!site) redirect(back);
    revalidateAndRedirect(back, `${back}/${site.id}?notice=imported`);
  }
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        ← Dive-site library
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          title="DiveDay common dive sites"
          description="Published, versioned starting points. Importing makes an independent shop briefing; later template updates never overwrite your edits."
        />
      </div>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {templates.map(({ template, version }) => (
          <li key={template.id} className="rounded-lg border border-border bg-surface p-5">
            <p className="text-sm font-medium text-primary">Template v{version.version}</p>
            <h2 className="mt-1 text-xl font-semibold">{version.briefing.name}</h2>
            <p className="mt-2 text-sm text-muted">{version.briefing.description}</p>
            <form action={importAction} className="mt-5">
              <input type="hidden" name="templateId" value={template.id} />
              <SubmitButton pendingLabel="Importing…" className={buttonClass()}>
                Import to my library
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
