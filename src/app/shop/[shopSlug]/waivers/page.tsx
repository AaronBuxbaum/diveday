import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getShopById, setShopJurisdiction } from "@/db/queries";
import { createWaiverTemplate, listWaiverTemplates, setDefaultWaiverTemplate } from "@/db/waivers";
import { MEDICAL_JURISDICTION_LABELS, questionnaireForJurisdiction } from "@/lib/medical";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Waiver templates — Scuba",
};

const templateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(40).max(12_000),
  makeDefault: z.string().optional(),
});

const jurisdictionSchema = z.object({ jurisdiction: z.enum(["rstc", "uk"]) });

export default async function WaiverTemplatesPage({
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const templates = await listWaiverTemplates(db, shop.id);

  async function createTemplateAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = templateSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/waivers?notice=invalid`);
    await createWaiverTemplate(await getDb(), {
      shopId: staff.user.shopId,
      title: parsed.data.title,
      body: parsed.data.body,
      makeDefault: parsed.data.makeDefault === "on",
    });
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/waivers`,
      `/shop/${staff.user.shopSlug}/waivers?notice=created`,
    );
  }

  async function chooseDefaultAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const templateId = String(formData.get("templateId") ?? "");
    const changed = templateId
      ? await setDefaultWaiverTemplate(await getDb(), staff.user.shopId, templateId)
      : false;
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/waivers`,
      `/shop/${staff.user.shopSlug}/waivers?notice=${changed ? "default" : "invalid"}`,
    );
  }

  async function chooseJurisdictionAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = jurisdictionSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/waivers?notice=invalid`);
    const updated = await setShopJurisdiction(
      await getDb(),
      staff.user.shopId,
      parsed.data.jurisdiction,
    );
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/waivers`,
      `/shop/${staff.user.shopSlug}/waivers?notice=${updated ? "jurisdiction" : "invalid"}`,
    );
  }

  const questionnaire = questionnaireForJurisdiction(shop.jurisdiction);
  const banner =
    notice === "created"
      ? "New template saved. It has its own immutable version."
      : notice === "default"
        ? "This is now the default for new waiver links."
        : notice === "jurisdiction"
          ? "Medical questionnaire updated for new waivers."
          : notice === "invalid"
            ? "That didn’t save. Give the template a title and at least a short release."
            : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Waiver templates</h1>
        <p className="mt-2 text-muted">
          New links snapshot their template, so a completed waiver always keeps the exact text a
          diver saw.
        </p>
      </header>

      {banner ? (
        <p
          role="status"
          className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${notice === "invalid" ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}
        >
          {banner}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Medical questionnaire</h2>
        <p className="mt-1 text-sm text-muted">
          Which diver medical form waivers present. A “yes” to any question is a physician-referral
          blocker, not a checkbox. Completed waivers keep the exact questionnaire version answered.
        </p>
        <form
          action={chooseJurisdictionAction}
          className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 sm:flex-row sm:items-end"
        >
          <FieldGrid columns={1} className="flex-1">
            <Field label="Jurisdiction">
              <select name="jurisdiction" defaultValue={shop.jurisdiction} className={controlClass}>
                {Object.entries(MEDICAL_JURISDICTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
          <button
            type="submit"
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            Save questionnaire
          </button>
        </form>
        <p className="mt-2 text-sm text-muted">
          Current form:{" "}
          <strong className="font-medium text-foreground">{questionnaire.title}</strong> ·{" "}
          {questionnaire.questions.length} questions.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Choose the default</h2>
        <p className="mt-1 text-sm text-muted">
          Staff can still choose another active template when issuing a link.
        </p>
        {templates.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            Create the first waiver template below.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {template.title}{" "}
                    <span className="font-normal text-muted">v{template.version}</span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{template.body}</p>
                </div>
                {template.isDefault ? (
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                    Default
                  </span>
                ) : (
                  <form action={chooseDefaultAction}>
                    <input type="hidden" name="templateId" value={template.id} />
                    <button
                      type="submit"
                      className={buttonClass({
                        variant: "secondary",
                        className: "text-foreground",
                      })}
                    >
                      Make default
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Create a new version</h2>
        <p className="mt-1 text-sm text-muted">
          Editing a release makes a new version; it never changes a waiver that has already been
          signed.
        </p>
        <form action={createTemplateAction} className="mt-5 flex flex-col gap-5">
          <FieldGrid columns={1} className="gap-y-5">
            <Field label="Template name">
              <input
                name="title"
                required
                maxLength={120}
                placeholder="Boat charter release"
                className={controlClass}
              />
            </Field>
            <Field label="Release text">
              <textarea
                name="body"
                required
                rows={8}
                maxLength={12_000}
                placeholder="Write the release the diver will read and sign."
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input name="makeDefault" type="checkbox" className="size-4 accent-primary" />
            Make this the default for new links
          </label>
          <div>
            <button type="submit" className={buttonClass({ size: "lg" })}>
              Save new template
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
