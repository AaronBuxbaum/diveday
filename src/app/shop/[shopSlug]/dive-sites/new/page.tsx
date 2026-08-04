import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { createDiveSite } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { type DepthUnit, maxEnteredDepth } from "@/lib/depth-units";
import {
  type DiveSiteFormError,
  parseDiveSiteForm,
  splitMediaUrls,
  submittedValues,
} from "@/lib/dive-sites";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { ingestDiveSiteMedia } from "@/lib/storage/ingest-dive-site-media";
import { SiteFormShell, type SiteFormState } from "../_components/SiteFormShell";
import { siteFormErrorMessages } from "../_components/site-form-errors";

// `instant = true` asserts that navigating *into* this page paints
// immediately. Not a claim of a static shell: the staff shell layout declares
// `instant = false` (read its comment for why), so a cold direct visit still
// blocks on the session and shop row. What this validates is the navigation
// staff make all day — arriving from another `/shop` page, where the shell
// is already mounted. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Create dive site — DiveDay" };

const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);

// Not `instant = false` (a dev-time validation opt-out only, with zero
// production effect — see ADR 20260801-cache-components-e2e-activity-migration's
// Outcome section). Without a real Suspense boundary this route got a
// Partial-Prerendered shell with an implicit dynamic hole around the
// session/shop reads below; an explicit boundary makes the dynamic part exactly
// what streams in. It used to matter for a second reason too — a rejected form
// fired `redirect(...?error=...)`, which raced that hole's pending fetch and
// lost, so the error banner never rendered. A refusal no longer navigates at
// all (see `SiteFormShell`), so that race is gone with the redirect.
export default function NewDiveSitePage({ params }: { params: Promise<{ shopSlug: string }> }) {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <NewDiveSiteBody params={params} />
    </Suspense>
  );
}

async function NewDiveSiteBody({ params }: { params: Promise<{ shopSlug: string }> }) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const back = `/shop/${shopSlug}/dive-sites`;
  const shop = await getShopById(await getDb(), session.user.shopId);
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));
  const depthUnit = shop?.depthUnit ?? "meters";

  async function createAction(_state: SiteFormState, formData: FormData): Promise<SiteFormState> {
    "use server";
    const activeSession = await requireStaffSession();
    // Every refusal carries the whole submission back to the form, which is
    // what lets a staffer fix the one field that was wrong instead of retyping
    // a briefing (see `SiteFormShell`).
    const refuse = (errorCode: DiveSiteFormError): SiteFormState => ({
      errorCode,
      values: submittedValues(formData),
    });
    // Depth arrives in whatever unit this shop works in; metres is what's
    // stored. Re-read the shop rather than trusting a form field for the unit —
    // a hidden input would let a crafted post store a depth 3.3× off.
    const activeShop = await getShopById(await getDb(), activeSession.user.shopId);
    const parsed = parseDiveSiteForm(
      Object.fromEntries(formData),
      activeShop?.depthUnit ?? "meters",
    );
    if (!parsed.ok) return refuse(parsed.error);
    let imageUrls: string[];
    try {
      imageUrls = splitMediaUrls(parsed.fields.imageUrls);
    } catch {
      return refuse("images");
    }
    const specialties = z
      .array(specialtySchema)
      .safeParse(formData.getAll("specialty").map(String));
    if (!specialties.success) return refuse("invalid");
    const landmarks = parsed.fields.landmarks
      .split("\n")
      .map((landmark) => landmark.trim())
      .filter(Boolean);
    // Every media URL becomes first-party before it's ever stored — a public
    // dive-site page must never make a live request to a staff-pasted
    // third-party host (CR-020).
    const media = await ingestDiveSiteMedia({
      satelliteImageUrl: parsed.fields.satelliteImageUrl || undefined,
      routeImageUrl: parsed.fields.routeImageUrl || undefined,
      imageUrls,
    });
    if (!media.ok) {
      return refuse(media.reason === "not_configured" ? "imagesUnconfigured" : "images");
    }
    // `maxDepth` is the form's unit-relative field, not a column — it became
    // `parsed.maxDepthMeters`, so it must not reach the spread.
    const { maxDepth: _maxDepth, ...siteFields } = parsed.fields;
    const site = await createDiveSite(await getDb(), {
      shopId: activeSession.user.shopId,
      ...siteFields,
      forecastLatitude:
        parsed.fields.forecastLatitude === "" ? undefined : parsed.fields.forecastLatitude,
      forecastLongitude:
        parsed.fields.forecastLongitude === "" ? undefined : parsed.fields.forecastLongitude,
      satelliteImageUrl: media.satelliteImageUrl,
      routeImageUrl: media.routeImageUrl,
      imageUrls: media.imageUrls,
      minimumCertificationLevel: parsed.fields.minimumCertificationLevel,
      requiredSpecialties: specialties.data,
      requiresNitrox: formData.get("requiresNitrox") === "on",
      difficulty: parsed.fields.difficulty,
      depthRange: parsed.fields.depthRange,
      maxDepthMeters: parsed.maxDepthMeters,
      currentNote: parsed.fields.currentNote,
      divePlan: parsed.fields.divePlan,
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
      <SiteFormShell
        action={createAction}
        errorMessages={siteFormErrorMessages(t, "diveSites.new.errorInvalid")}
      >
        <SiteFormFields
          t={t}
          submitLabel={t("diveSites.new.saveSiteBriefing")}
          depthUnit={depthUnit}
        />
      </SiteFormShell>
    </main>
  );
}

/**
 * The blank briefing's fields. Rendered on the server (staff copy is
 * server-side) and handed to `SiteFormShell` as children, so a refused submit
 * re-renders nothing here and every value the staffer typed survives.
 */
function SiteFormFields({
  t,
  submitLabel,
  depthUnit,
}: {
  t: StaffTranslator;
  submitLabel: string;
  /** How this shop reads depth; the stored figure is always metres. */
  depthUnit: DepthUnit;
}) {
  return (
    <>
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
    </>
  );
}
