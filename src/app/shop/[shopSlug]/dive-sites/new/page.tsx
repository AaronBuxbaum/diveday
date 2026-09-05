import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";
import { EditorRail, UnsavedSections } from "@/components/editor/EditorRail";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { createDiveSiteForForm, SITE_NAME_TAKEN } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { type DiveSiteFormError, parseDiveSiteForm, submittedValues } from "@/lib/dive-sites";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface, requireStaffSession } from "@/lib/session";
import { uploadDiveSitePhotos } from "@/lib/storage/dive-site-photos";
import { routeEditorCopy } from "../_components/route-editor-copy";
import { SiteFields } from "../_components/SiteFields";
import { SiteFormShell, type SiteFormState } from "../_components/SiteFormShell";
import {
  fieldGuideEditorCopy,
  landmarkEditorCopy,
  marineLifeCatalogEntries,
} from "../_components/site-editor-copy";
import { siteFormErrorMessages } from "../_components/site-form-errors";
import { siteFormSections, siteFormUnsavedCopy } from "../_components/site-form-sections";

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
  const { shopSlug } = await params;
  const back = `/shop/${shopSlug}/dive-sites`;
  const { shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // The species picker previews what a *diver* will read off this site's
  // briefing, so its words come from the diver bundle -- in the staffer's own
  // language, resolved from the same locale.
  const diverT = diverTranslator(locale);
  const depthUnit = shop.depthUnit ?? "meters";

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
    const specialties = z
      .array(specialtySchema)
      .safeParse(formData.getAll("specialty").map(String));
    if (!specialties.success) return refuse("invalid");
    // Uploaded from the staffer's own device straight into first-party
    // storage — there is no pasted URL for a public page to fetch (CR-020).
    const photos = await uploadDiveSitePhotos(formData);
    if (!photos.ok) {
      return refuse(photos.reason === "not_configured" ? "imagesUnconfigured" : "images");
    }
    // `maxDepth` and `expectedBottomTime` are the form's own fields, not
    // columns — they became `parsed.maxDepthMeters` /
    // `parsed.expectedBottomTimeMinutes`, so neither may reach the spread.
    const {
      maxDepth: _maxDepth,
      expectedBottomTime: _expectedBottomTime,
      // The note and its author are one value on the row (issue #1204).
      planningNote: planningNoteWords,
      ...siteFields
    } = parsed.fields;
    const site = await createDiveSiteForForm(await getDb(), {
      shopId: activeSession.user.shopId,
      ...siteFields,
      forecastLatitude:
        parsed.fields.forecastLatitude === "" ? null : parsed.fields.forecastLatitude,
      forecastLongitude:
        parsed.fields.forecastLongitude === "" ? null : parsed.fields.forecastLongitude,
      satelliteImageUrl: photos.photos.satelliteImageUrl,
      routeImageUrl: photos.photos.routeImageUrl,
      imageUrls: photos.photos.imageUrls,
      planningNote: { words: planningNoteWords, byPersonId: activeSession.user.personId },
      minimumCertificationLevel: parsed.fields.minimumCertificationLevel,
      requiredSpecialties: specialties.data,
      requiresNitrox: formData.get("requiresNitrox") === "on",
      difficultyLevel: parsed.difficultyLevel,
      depthRange: parsed.fields.depthRange,
      maxDepthMeters: parsed.maxDepthMeters,
      expectedBottomTimeMinutes: parsed.expectedBottomTimeMinutes,
      currentNote: parsed.fields.currentNote,
      divePlan: parsed.fields.divePlan,
      conservationNote: parsed.fields.conservationNote,
      fitTone: parsed.fields.fitTone,
      fitNote: parsed.fields.fitNote,
      fieldGuideTipsHeading: parsed.fields.fieldGuideTipsHeading,
      landmarks: parsed.landmarks,
      // The field guide is written on this same form now, so a brand-new site
      // can arrive with one — every species the staffer picked from the
      // catalog, in the order they put them.
      creatures: parsed.creatures,
      routePoints: parsed.route.points,
      routeLabel: parsed.route.label,
      routeNote: parsed.route.note,
      routeZoom: parsed.route.zoom,
    });
    // The name is the one rule the parse above could not check — it takes the
    // whole shop's library to know, and an archived site still holds its name —
    // so the database refuses it and the briefing comes back to the form.
    if (site === SITE_NAME_TAKEN) return refuse("nameTaken");
    revalidateAndRedirect(back, `${back}/${site.id}`);
  }

  const sections = siteFormSections(t);

  return (
    // Wider from `lg` up than the 3xl it was: the rail takes a column of its
    // own beside the form rather than out of it, so the fields keep the
    // measure they had (ADR 20260827-the-shops-shelves, the long-form editor
    // pattern).
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl">
      <div>
        <ShopPageHeader
          eyebrow={t("diveSites.backToLibrary")}
          eyebrowHref={back}
          title={t("diveSites.new.title")}
          description={t("diveSites.new.description")}
        />
      </div>
      <div className="mt-8 lg:grid lg:grid-cols-[13.75rem_1fr] lg:gap-x-14">
        <EditorRail sections={sections} navLabel={t("diveSites.form.sectionsLabel")} />
        <div className="min-w-0">
          <SiteFormShell
            action={createAction}
            errorMessages={siteFormErrorMessages(t, "diveSites.new.errorInvalid")}
            actions={
              <>
                <SubmitButton pendingLabel={t("diveSites.form.saving")} className={buttonClass()}>
                  {t("diveSites.new.saveSiteBriefing")}
                </SubmitButton>
                <UnsavedSections sections={sections} copy={siteFormUnsavedCopy(t)} />
              </>
            }
          >
            <SiteFields
              t={t}
              depthUnit={depthUnit}
              routeCopy={routeEditorCopy(t)}
              landmarkCopy={landmarkEditorCopy(t)}
              fieldGuideCopy={fieldGuideEditorCopy(t)}
              marineLifeCatalog={marineLifeCatalogEntries(diverT)}
              locale={locale}
              timezone={shop.timezone}
              certificationDescription={t("diveSites.new.certificationDescription")}
            />
          </SiteFormShell>
        </div>
      </div>
    </main>
  );
}
