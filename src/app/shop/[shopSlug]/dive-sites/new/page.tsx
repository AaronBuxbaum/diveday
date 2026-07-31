import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { createDiveSite } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import {
  type DepthUnit,
  depthToMeters,
  MAX_ENTERED_DEPTH_METERS,
  maxEnteredDepth,
} from "@/lib/depth-units";
import { splitMediaUrls } from "@/lib/dive-sites";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { ingestDiveSiteMedia } from "@/lib/storage/ingest-dive-site-media";

export const metadata: Metadata = { title: "Create dive site — DiveDay" };

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
    // Typed in the shop's own unit (metres or feet), so the real bound can only
    // be applied after the unit is known — this is the loose outer guard, and
    // `depthToMeters`/`MAX_ENTERED_DEPTH_METERS` below apply the true ceiling.
    maxDepth: z.union([z.literal(""), z.coerce.number().positive().max(1_000)]),
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

export default async function NewDiveSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { error } = await searchParams;
  const back = `/shop/${shopSlug}/dive-sites`;
  const shop = await getShopById(await getDb(), session.user.shopId);
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));
  const depthUnit = shop?.depthUnit ?? "meters";

  async function createAction(formData: FormData) {
    "use server";
    const activeSession = await requireStaffSession();
    const parsed = siteSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}/new?error=invalid`);
    // Depth arrives in whatever unit this shop works in; metres is what's
    // stored. Re-read the shop rather than trusting a form field for the unit —
    // a hidden input would let a crafted post store a depth 3.3× off.
    const activeShop = await getShopById(await getDb(), activeSession.user.shopId);
    const maxDepthMeters =
      parsed.data.maxDepth === ""
        ? null
        : depthToMeters(parsed.data.maxDepth, activeShop?.depthUnit ?? "meters");
    if (maxDepthMeters !== null && maxDepthMeters > MAX_ENTERED_DEPTH_METERS) {
      redirect(`${back}/new?error=invalid`);
    }
    let imageUrls: string[];
    try {
      imageUrls = splitMediaUrls(parsed.data.imageUrls);
    } catch {
      redirect(`${back}/new?error=images`);
    }
    const specialties = z
      .array(specialtySchema)
      .safeParse(formData.getAll("specialty").map(String));
    if (!specialties.success) redirect(`${back}/new?error=invalid`);
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
        `${back}/new?error=${media.reason === "not_configured" ? "images-unconfigured" : "images"}`,
      );
    }
    // `maxDepth` is the form's unit-relative field, not a column — it becomes
    // `maxDepthMeters` below, so it must not reach the spread.
    const { maxDepth: _maxDepth, ...siteFields } = parsed.data;
    const site = await createDiveSite(await getDb(), {
      shopId: activeSession.user.shopId,
      ...siteFields,
      forecastLatitude:
        parsed.data.forecastLatitude === "" ? undefined : parsed.data.forecastLatitude,
      forecastLongitude:
        parsed.data.forecastLongitude === "" ? undefined : parsed.data.forecastLongitude,
      satelliteImageUrl: media.satelliteImageUrl,
      routeImageUrl: media.routeImageUrl,
      imageUrls: media.imageUrls,
      minimumCertificationLevel: parsed.data.minimumCertificationLevel,
      requiredSpecialties: specialties.data,
      requiresNitrox: formData.get("requiresNitrox") === "on",
      difficulty: parsed.data.difficulty,
      depthRange: parsed.data.depthRange,
      maxDepthMeters,
      currentNote: parsed.data.currentNote,
      divePlan: parsed.data.divePlan,
      landmarks,
    });
    revalidateAndRedirect(back, `${back}/${site.id}`);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        {t("diveSites.backToLibrary")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={t("diveSites.catalogEyebrow")}
          title={t("diveSites.new.title")}
          description={t("diveSites.new.description")}
        />
      </div>
      {error ? (
        <ShopNotice tone="danger" role="alert" className="mt-6">
          {error === "images"
            ? t("diveSites.form.errorImages")
            : error === "images-unconfigured"
              ? t("diveSites.form.errorImagesUnconfigured")
              : t("diveSites.new.errorInvalid")}
        </ShopNotice>
      ) : null}
      <SiteForm
        t={t}
        action={createAction}
        submitLabel={t("diveSites.new.saveSiteBriefing")}
        depthUnit={depthUnit}
      />
    </main>
  );
}

function SiteForm({
  t,
  action,
  submitLabel,
  depthUnit,
}: {
  t: StaffTranslator;
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  /** How this shop reads depth; the stored figure is always metres. */
  depthUnit: DepthUnit;
}) {
  return (
    <form action={action} className="mt-8 flex flex-col gap-5">
      <FieldGrid columns={1}>
        <Field label={t("diveSites.form.nameLabel")}>
          <input
            name="name"
            required
            maxLength={120}
            placeholder={t("diveSites.form.namePlaceholder")}
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
            placeholder={t("diveSites.form.locationPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.descriptionLabel")}>
          <textarea name="description" rows={3} maxLength={1200} className={controlClass} />
        </Field>
      </FieldGrid>
      <FieldGrid columns={2} className="gap-y-5">
        <Field label={t("diveSites.form.satelliteImageLabel")}>
          <textarea name="satelliteImageUrl" rows={2} className={controlClass} />
        </Field>
        <Field label={t("diveSites.form.routeImageLabel")} hint={t("diveSites.form.optionalHint")}>
          <textarea name="routeImageUrl" rows={2} className={controlClass} />
        </Field>
      </FieldGrid>
      <FieldGrid columns={1} className="gap-y-5">
        <Field
          label={t("diveSites.form.sitePhotosLabel")}
          hint={t("diveSites.form.sitePhotosHint")}
        >
          <textarea name="imageUrls" rows={4} className={controlClass} />
        </Field>
        <Field label={t("diveSites.form.marineLifeLabel")}>
          <input
            name="marineLife"
            maxLength={400}
            placeholder={t("diveSites.form.marineLifePlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.briefingLabel")}>
          <textarea
            name="marineLifeDescription"
            rows={3}
            maxLength={1200}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <FieldGrid columns={2} className="gap-y-5">
        <Field label={t("diveSites.form.difficultyLabel")} hint={t("diveSites.form.optionalHint")}>
          <input
            name="difficulty"
            maxLength={120}
            placeholder={t("diveSites.form.difficultyPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.depthRangeLabel")} hint={t("diveSites.form.optionalHint")}>
          <input
            name="depthRange"
            maxLength={120}
            placeholder={t("diveSites.form.depthRangePlaceholder")}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <FieldGrid columns={2} className="gap-y-5">
        {/* The one depth figure a certification ceiling can be compared against
            (H-08). Left blank it simply never warns — this advises, it never gates. */}
        <Field
          label={t(
            depthUnit === "feet"
              ? "diveSites.form.maxDepthFeetLabel"
              : "diveSites.form.maxDepthMetersLabel",
          )}
          hint={t("diveSites.form.maxDepthHint")}
        >
          <input
            name="maxDepth"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxEnteredDepth(depthUnit)}
            step={1}
            placeholder={depthUnit === "feet" ? "60" : "18"}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <FieldGrid columns={1} className="gap-y-5">
        <Field label={t("diveSites.form.currentNoteLabel")} hint={t("diveSites.form.optionalHint")}>
          <textarea name="currentNote" rows={2} maxLength={500} className={controlClass} />
        </Field>
        <Field label={t("diveSites.form.divePlanLabel")} hint={t("diveSites.form.optionalHint")}>
          <textarea
            name="divePlan"
            rows={3}
            maxLength={1200}
            placeholder={t("diveSites.form.divePlanPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.landmarksLabel")} hint={t("diveSites.form.landmarksHint")}>
          <textarea name="landmarks" rows={3} maxLength={4000} className={controlClass} />
        </Field>
      </FieldGrid>
      <fieldset className="rounded-2xl border border-border bg-surface-sunken p-5">
        <legend className="px-1 text-sm font-medium">
          {t("diveSites.form.certificationLegend")}
        </legend>
        <p className="text-sm text-muted">{t("diveSites.new.certificationDescription")}</p>
        <FieldGrid columns={1} className="mt-4">
          <Field label={t("diveSites.form.minimumCertificationLabel")}>
            <select name="minimumCertificationLevel" defaultValue="" className={controlClass}>
              <option value="">{t("diveSites.form.noLevelRequired")}</option>
              {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
          </Field>
        </FieldGrid>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                name="specialty"
                type="checkbox"
                value={value}
                className="size-4 accent-primary"
              />
              {t(key)}
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input name="requiresNitrox" type="checkbox" className="size-4 accent-primary" />
            {t("diveSites.form.nitroxCheckbox")}
          </label>
        </div>
      </fieldset>
      <SubmitButton
        pendingLabel={t("diveSites.form.saving")}
        className={buttonClass({ size: "lg", className: "mt-2 self-start text-base" })}
      >
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
