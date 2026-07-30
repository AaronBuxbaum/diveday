import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import {
  copyDiveSite,
  deleteDiveSite,
  getDiveSite,
  listDiveSites,
  updateDiveSite,
} from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { splitMediaUrls } from "@/lib/dive-sites";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { ingestDiveSiteMedia } from "@/lib/storage/ingest-dive-site-media";

export const metadata: Metadata = { title: "Edit dive site — DiveDay" };

const optionalUrl = z.union([z.literal(""), z.url().max(2_000)]);
const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);
const siteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_200),
    locationName: z.string().trim().max(160),
    forecastLatitude: z.union([z.literal(""), z.coerce.number().min(-90).max(90)]),
    forecastLongitude: z.union([z.literal(""), z.coerce.number().min(-180).max(180)]),
    satelliteImageUrl: optionalUrl,
    routeImageUrl: optionalUrl,
    imageUrls: z.string().max(12_000),
    marineLife: z.string().trim().max(400),
    marineLifeDescription: z.string().trim().max(1_200),
    difficulty: z.string().trim().max(120),
    depthRange: z.string().trim().max(120),
    currentNote: z.string().trim().max(500),
    divePlan: z.string().trim().max(1_200),
    landmarks: z.string().max(4_000),
    minimumCertificationLevel: z.preprocess(
      (value) => (value === "" ? null : value),
      z
        .enum(["open_water", "advanced_open_water", "rescue", "divemaster", "instructor"])
        .nullable(),
    ),
  })
  .refine(
    (site) => (site.forecastLatitude === "") === (site.forecastLongitude === ""),
    "Add both forecast coordinates or leave both blank.",
  );

export default async function EditDiveSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id } = await params;
  const { notice, error } = await searchParams;
  const back = `/shop/${shopSlug}/dive-sites`;
  const db = await getDb();
  const [site, shop] = await Promise.all([
    getDiveSite(db, session.user.shopId, id),
    getShopById(db, session.user.shopId),
  ]);
  if (!site) notFound();
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));

  async function saveAction(formData: FormData) {
    "use server";
    const activeSession = await requireStaffSession();
    const parsed = siteSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}/${id}?error=invalid`);
    const specialties = z
      .array(specialtySchema)
      .safeParse(formData.getAll("specialty").map(String));
    if (!specialties.success) redirect(`${back}/${id}?error=invalid`);
    let imageUrls: string[];
    try {
      imageUrls = splitMediaUrls(parsed.data.imageUrls);
    } catch {
      redirect(`${back}/${id}?error=images`);
    }
    const landmarks = parsed.data.landmarks
      .split("\n")
      .map((landmark) => landmark.trim())
      .filter(Boolean);
    // Every media URL becomes first-party before it's ever stored — a public
    // dive-site page must never make a live request to a staff-pasted
    // third-party host (CR-020).
    const media = await ingestDiveSiteMedia({
      satelliteImageUrl: parsed.data.satelliteImageUrl || undefined,
      routeImageUrl: parsed.data.routeImageUrl || undefined,
      imageUrls,
    });
    if (!media.ok) {
      redirect(
        `${back}/${id}?error=${media.reason === "not_configured" ? "images-unconfigured" : "images"}`,
      );
    }
    const updated = await updateDiveSite(await getDb(), activeSession.user.shopId, id, {
      shopId: activeSession.user.shopId,
      ...parsed.data,
      forecastLatitude: parsed.data.forecastLatitude === "" ? null : parsed.data.forecastLatitude,
      forecastLongitude:
        parsed.data.forecastLongitude === "" ? null : parsed.data.forecastLongitude,
      satelliteImageUrl: media.satelliteImageUrl,
      routeImageUrl: media.routeImageUrl,
      imageUrls: media.imageUrls,
      minimumCertificationLevel: parsed.data.minimumCertificationLevel,
      requiredSpecialties: specialties.data,
      requiresNitrox: formData.get("requiresNitrox") === "on",
      difficulty: parsed.data.difficulty,
      depthRange: parsed.data.depthRange,
      currentNote: parsed.data.currentNote,
      divePlan: parsed.data.divePlan,
      landmarks,
    });
    if (!updated) notFound();
    revalidateAndRedirect(`${back}/${id}`, `${back}/${id}?notice=saved`);
  }

  async function copyAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const activeDb = await getDb();
    const names = new Set(
      (await listDiveSites(activeDb, activeSession.user.shopId)).map((entry) => entry.name),
    );
    let copyName = `${site.name} copy`;
    let number = 2;
    while (names.has(copyName)) copyName = `${site.name} copy ${number++}`;
    const copy = await copyDiveSite(activeDb, activeSession.user.shopId, id, copyName);
    if (!copy) notFound();
    revalidateAndRedirect(back, `${back}/${copy.id}?notice=copied`);
  }

  async function deleteAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const deleted = await deleteDiveSite(await getDb(), activeSession.user.shopId, id);
    revalidateAndRedirect(
      back,
      deleted ? `${back}?notice=archived` : `${back}/${id}?error=invalid`,
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        {t("diveSites.backToLibrary")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={t("diveSites.catalogEyebrow")}
          title={site.name}
          description={t("diveSites.edit.description")}
          actions={
            <>
              <form action={copyAction}>
                <SubmitButton
                  pendingLabel={t("diveSites.edit.copying")}
                  className={buttonClass({ variant: "secondary", className: "text-foreground" })}
                >
                  {t("diveSites.edit.copyAndTailor")}
                </SubmitButton>
              </form>
              <details className="w-full sm:w-auto">
                <summary className="flex min-h-11 cursor-pointer items-center rounded-lg border border-danger/30 px-4 py-2 text-center text-sm font-medium text-danger">
                  {t("diveSites.edit.archiveSite")}
                </summary>
                <form
                  action={deleteAction}
                  className="mt-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm sm:w-72"
                >
                  <p className="text-muted">{t("diveSites.edit.archiveConfirmBody")}</p>
                  <SubmitButton
                    pendingLabel={t("diveSites.edit.archiving")}
                    className={buttonClass({ variant: "danger-solid", className: "mt-3" })}
                  >
                    {t("diveSites.edit.archiveSite")}
                  </SubmitButton>
                </form>
              </details>
            </>
          }
        />
      </div>
      {notice ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success"
        >
          {notice === "copied" ? t("diveSites.edit.copiedNotice") : t("diveSites.edit.savedNotice")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error === "images"
            ? t("diveSites.form.errorImages")
            : error === "images-unconfigured"
              ? t("diveSites.form.errorImagesUnconfigured")
              : t("diveSites.edit.errorInvalid")}
        </p>
      ) : null}
      <form action={saveAction} className="mt-8 flex flex-col gap-5">
        <FieldGrid columns={1}>
          <Field label={t("diveSites.form.nameLabel")}>
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={site.name}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <fieldset className="rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">{t("diveSites.form.forecastLegend")}</legend>
          <p className="mt-1 text-sm text-muted">{t("diveSites.form.forecastDescription")}</p>
          <FieldGrid columns={2} className="mt-4 gap-y-5">
            <Field label={t("diveSites.form.latitudeLabel")}>
              <input
                name="forecastLatitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                defaultValue={site.forecastLatitude ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("diveSites.form.longitudeLabel")}>
              <input
                name="forecastLongitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                defaultValue={site.forecastLongitude ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>
        <FieldGrid columns={1} className="gap-y-5">
          <Field label={t("diveSites.form.locationLabel")} hint={t("diveSites.form.optionalHint")}>
            <input
              name="locationName"
              maxLength={160}
              defaultValue={site.locationName ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("diveSites.form.descriptionLabel")}>
            <textarea
              name="description"
              rows={3}
              maxLength={1200}
              defaultValue={site.description ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={2} className="gap-y-5">
          <Field label={t("diveSites.form.satelliteImageLabel")}>
            <textarea
              name="satelliteImageUrl"
              rows={2}
              defaultValue={site.satelliteImageUrl ?? ""}
              className={controlClass}
            />
          </Field>
          <Field
            label={t("diveSites.form.routeImageLabel")}
            hint={t("diveSites.form.optionalHint")}
          >
            <textarea
              name="routeImageUrl"
              rows={2}
              defaultValue={site.routeImageUrl ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={1} className="gap-y-5">
          <Field
            label={t("diveSites.form.sitePhotosLabel")}
            hint={t("diveSites.form.sitePhotosHint")}
          >
            <textarea
              name="imageUrls"
              rows={4}
              defaultValue={site.imageUrls.join("\n")}
              className={controlClass}
            />
          </Field>
          <Field label={t("diveSites.form.marineLifeLabel")}>
            <input
              name="marineLife"
              maxLength={400}
              defaultValue={site.marineLife ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("diveSites.form.briefingLabel")}>
            <textarea
              name="marineLifeDescription"
              rows={3}
              maxLength={1200}
              defaultValue={site.marineLifeDescription ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={2} className="gap-y-5">
          <Field
            label={t("diveSites.form.difficultyLabel")}
            hint={t("diveSites.form.optionalHint")}
          >
            <input
              name="difficulty"
              maxLength={120}
              defaultValue={site.difficulty ?? ""}
              placeholder={t("diveSites.form.difficultyPlaceholder")}
              className={controlClass}
            />
          </Field>
          <Field
            label={t("diveSites.form.depthRangeLabel")}
            hint={t("diveSites.form.optionalHint")}
          >
            <input
              name="depthRange"
              maxLength={120}
              defaultValue={site.depthRange ?? ""}
              placeholder={t("diveSites.form.depthRangePlaceholder")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={1} className="gap-y-5">
          <Field
            label={t("diveSites.form.currentNoteLabel")}
            hint={t("diveSites.form.optionalHint")}
          >
            <textarea
              name="currentNote"
              rows={2}
              maxLength={500}
              defaultValue={site.currentNote ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("diveSites.form.divePlanLabel")} hint={t("diveSites.form.optionalHint")}>
            <textarea
              name="divePlan"
              rows={3}
              maxLength={1200}
              defaultValue={site.divePlan ?? ""}
              placeholder={t("diveSites.form.divePlanPlaceholder")}
              className={controlClass}
            />
          </Field>
          <Field
            label={t("diveSites.form.landmarksLabel")}
            hint={t("diveSites.form.landmarksHint")}
          >
            <textarea
              name="landmarks"
              rows={3}
              maxLength={4000}
              defaultValue={site.landmarks.join("\n")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <fieldset className="rounded-lg border border-border bg-surface-sunken p-5">
          <legend className="px-1 text-sm font-medium">
            {t("diveSites.form.certificationLegend")}
          </legend>
          <p className="text-sm text-muted">{t("diveSites.edit.certificationDescription")}</p>
          <FieldGrid columns={1} className="mt-4">
            <Field label={t("diveSites.form.minimumCertificationLabel")}>
              <select
                name="minimumCertificationLevel"
                defaultValue={site.minimumCertificationLevel ?? ""}
                className={controlClass}
              >
                <option value="">{t("diveSites.form.noLevelRequired")}</option>
                {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
          <div className="mt-4">
            <p className="text-sm font-medium">{t("diveSites.edit.requiredSpecialties")}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input
                    name="specialty"
                    type="checkbox"
                    value={value}
                    defaultChecked={site.requiredSpecialties.includes(
                      value as keyof typeof SPECIALTY_KEYS,
                    )}
                    className="size-4 accent-primary"
                  />
                  {t(key)}
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  name="requiresNitrox"
                  type="checkbox"
                  defaultChecked={site.requiresNitrox}
                  className="size-4 accent-primary"
                />
                {t("diveSites.form.nitroxCheckbox")}
              </label>
            </div>
          </div>
        </fieldset>
        <SubmitButton
          pendingLabel={t("diveSites.form.saving")}
          className={buttonClass({ size: "lg", className: "mt-2 self-start text-base" })}
        >
          {t("diveSites.edit.saveBriefing")}
        </SubmitButton>
      </form>
    </main>
  );
}
