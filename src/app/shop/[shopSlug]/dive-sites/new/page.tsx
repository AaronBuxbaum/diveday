import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { UnsavedSections } from "@/components/editor/EditorRail";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { assistsAvailable } from "@/db/assists";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { routeEditorCopy } from "../_components/route-editor-copy";
import { siteBriefAssist } from "../_components/SiteAssists";
import { SiteFields } from "../_components/SiteFields";
import { SiteFormShell } from "../_components/SiteFormShell";
import {
  fieldGuideEditorCopy,
  landmarkEditorCopy,
  marineLifeCatalogEntries,
} from "../_components/site-editor-copy";
import { siteFormErrorMessages } from "../_components/site-form-errors";
import { siteFormSections, siteFormUnsavedCopy } from "../_components/site-form-sections";
import { createDiveSiteAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Create dive site — DiveDay" };

// Not `instant = false` (a dev-time validation opt-out only, with zero
// production effect — see ADR 20260801-cache-components-e2e-activity-migration's
// Outcome section). Without a real Suspense boundary this route got a
// Partial-Prerendered shell with an implicit dynamic hole around the
// session/shop reads below; an explicit boundary makes the dynamic part exactly
// what streams in.
export default function NewDiveSitePage({ params }: { params: Promise<{ shopSlug: string }> }) {
  return (
    // The fallback is the page's own shell at its width, so the column does
    // not jump sideways when the body streams in (visual review, layer 7).
    <Suspense fallback={<StaffPage width="reading">{null}</StaffPage>}>
      <NewDiveSiteBody params={params} />
    </Suspense>
  );
}

async function NewDiveSiteBody({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const back = `/shop/${shopSlug}/dive-sites`;
  const { db, shop } = await requireShopSurface(shopSlug);
  const canAssist = await assistsAvailable(db, shop.id);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // The species picker previews what a *diver* will read off this site's
  // briefing, so its words come from the diver bundle -- in the staffer's own
  // language, resolved from the same locale.
  const diverT = diverTranslator(locale);
  const depthUnit = shop.depthUnit ?? "meters";

  const sections = siteFormSections(t, shop.fieldGuideEnabled);

  return (
    // The form's own measure: the jump rail that widened this page from `lg`
    // up is gone (visual review 2026-10-24, A11).
    <StaffPage width="reading">
      <div>
        <ShopPageHeader
          eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.diveSites)}
          eyebrowHref={back}
          title={t("diveSites.new.title")}
          description={t("diveSites.new.description")}
          descriptionIsCaption
        />
      </div>
      <div className="mt-8">
        <SiteFormShell
          action={createDiveSiteAction}
          errorMessages={siteFormErrorMessages(t, "diveSites.new.errorInvalid")}
          actions={
            <>
              <SubmitButton pendingLabel={t("diveSites.form.saving")} className={buttonClass()}>
                {t("diveSites.form.save")}
              </SubmitButton>
              <UnsavedSections
                sections={sections}
                copy={siteFormUnsavedCopy(t, shop.fieldGuideEnabled)}
              />
            </>
          }
        >
          <SiteFields
            fieldGuideOn={shop.fieldGuideEnabled}
            t={t}
            depthUnit={depthUnit}
            routeCopy={routeEditorCopy(t)}
            landmarkCopy={landmarkEditorCopy(t)}
            fieldGuideCopy={fieldGuideEditorCopy(t)}
            marineLifeCatalog={marineLifeCatalogEntries(diverT)}
            locale={locale}
            timezone={shop.timezone}
            certificationDescription={t("diveSites.new.certificationDescription")}
            briefAssist={siteBriefAssist(shopSlug, canAssist, t)}
          />
        </SiteFormShell>
      </div>
    </StaffPage>
  );
}
