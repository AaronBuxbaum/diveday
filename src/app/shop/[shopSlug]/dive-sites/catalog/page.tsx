import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { importGlobalDiveSiteTemplate, listGlobalDiveSiteTemplates } from "@/db/dive-sites";
import { getShopById } from "@/db/queries";
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
    redirect(`${back}/${site.id}?notice=imported`);
  }
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        ← Dive-site library
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Scuba common dive sites</h1>
      <p className="mt-1 text-muted">
        Published, versioned starting points. Importing makes an independent shop briefing; later
        template updates never overwrite your edits.
      </p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {templates.map(({ template, version }) => (
          <li key={template.id} className="rounded-lg border border-border bg-surface p-5">
            <p className="text-sm font-medium text-primary">Template v{version.version}</p>
            <h2 className="mt-1 text-xl font-semibold">{version.briefing.name}</h2>
            <p className="mt-2 text-sm text-muted">{version.briefing.description}</p>
            <form action={importAction} className="mt-5">
              <input type="hidden" name="templateId" value={template.id} />
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Import to my library
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
