import { UnsavedSections } from "@/components/editor/EditorRail";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { assistsAvailable } from "@/db/assists";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ShopSurface } from "@/lib/session";
import { createDiveSiteAction } from "../create-site-actions";
import { routeEditorCopy } from "./route-editor-copy";
import { siteBriefAssist } from "./SiteAssists";
import { SiteFields } from "./SiteFields";
import { SiteFormShell } from "./SiteFormShell";
import {
  fieldGuideEditorCopy,
  landmarkEditorCopy,
  marineLifeCatalogEntries,
} from "./site-editor-copy";
import { siteFormErrorMessages } from "./site-form-errors";
import { siteFormSections, siteFormUnsavedCopy } from "./site-form-sections";

/**
 * **A new dive site**: the library's add panel (`/dive-sites?add=1`), the same
 * form the site's own editor (`dive-sites/[id]`) draws, empty. A refusal does
 * not navigate: it answers into the form with the whole submission
 * (`SiteFormShell`), and a saved site opens on its own page.
 */
export async function NewSitePanel({
  surface: { db, shop },
  shopSlug,
  t,
  locale,
}: {
  surface: ShopSurface;
  shopSlug: string;
  t: StaffTranslator;
  locale: DiverLocale;
}) {
  const canAssist = await assistsAvailable(db, shop.id);
  // The species picker previews what a *diver* will read off this site's
  // briefing, so its words come from the diver bundle, in the staffer's own
  // language.
  const diverT = diverTranslator(locale);
  const sections = siteFormSections(t, shop.fieldGuideEnabled);

  return (
    <SiteFormShell
      action={createDiveSiteAction}
      errorMessages={siteFormErrorMessages(t, "diveSites.new.errorInvalid")}
      actions={
        <>
          <SubmitButton pendingLabel={t("words.busy.saving")} className={buttonClass()}>
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
        depthUnit={shop.depthUnit ?? "meters"}
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
  );
}
