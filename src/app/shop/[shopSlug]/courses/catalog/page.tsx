import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { importGlobalCourseTemplate, listGlobalCourseTemplates } from "@/db/courses";
import { getShopById } from "@/db/shops";
import { revalidateAndRedirect } from "@/lib/navigation";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Course catalog — Scuba" };

export default async function CourseCatalogPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();
  const [shop, templates] = await Promise.all([
    getShopById(db, session.user.shopId),
    listGlobalCourseTemplates(db),
  ]);
  const back = `/shop/${shopSlug}/courses`;

  async function importAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const templateId = String(formData.get("templateId") ?? "");
    const course = templateId
      ? await importGlobalCourseTemplate(await getDb(), staff.user.shopId, templateId)
      : null;
    if (!course) redirect(`${back}?notice=invalid`);
    revalidateAndRedirect(back, `${back}/${course.slug}/edit?notice=imported`);
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        ← Courses
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={shop?.name}
          title="Scuba course pages"
          description="Written starting points for the agency catalog: day plans, what the fee covers, and the questions divers actually ask. Importing makes an independent copy — later updates never overwrite your words, and never change a prerequisite under a course you already teach."
        />
      </div>
      {templates.length === 0 ? (
        <EmptyState className="mt-8">
          <h2 className="text-lg font-semibold">No course pages published yet</h2>
          <p className="mt-2 text-sm text-muted">
            Scuba publishes these centrally. In the meantime, write a course page from the course
            list.
          </p>
        </EmptyState>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {templates.map(({ template, version }) => (
            <li key={template.id} className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-xs font-semibold tracking-wider text-primary uppercase">
                {version.agency} · v{version.version}
              </p>
              <h2 className="mt-1 text-xl font-semibold">{version.title}</h2>
              <p className="mt-2 text-sm text-muted">{version.content.summary}</p>
              <p className="mt-3 text-sm text-muted">
                {version.minimumCertificationLevel
                  ? `Requires ${CERTIFICATION_LEVEL_LABELS[version.minimumCertificationLevel]} or higher`
                  : "Open to uncertified divers"}
                {version.content.scheduleDays.length > 0
                  ? ` · ${version.content.scheduleDays.length}-day plan`
                  : ""}
                {version.content.faqs.length > 0 ? ` · ${version.content.faqs.length} FAQs` : ""}
              </p>
              <form action={importAction} className="mt-5">
                <input type="hidden" name="templateId" value={template.id} />
                <SubmitButton pendingLabel="Importing…" className={buttonClass()}>
                  Import and edit
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
