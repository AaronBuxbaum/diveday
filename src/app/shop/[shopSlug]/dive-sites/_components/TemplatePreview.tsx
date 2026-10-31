import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass, TONE_PANEL_CLASS } from "@/components/ui/card";
import { groupLabelClass } from "@/components/ui/group-label";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { GlobalDiveSiteTemplateRow } from "@/db/dive-sites";
import { isMarineLifeSlug } from "@/db/marine-life-catalog";
import { staffDiveSiteDepthText } from "@/i18n/depth-labels";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import type { DiverTranslator } from "@/i18n/messages";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import { capturePhoto } from "@/lib/marine-life-tiles";

/**
 * One catalog template, whole, before a shop decides to take it.
 *
 * Deliberately not the diver-facing briefing component: this is the *staff*
 * question "what would I be adopting, and what would I still have to write?",
 * so it shows the fields as fields — including the ones a diver never sees as
 * a list, like the cert gate and the field guide's species names.
 */
export function TemplatePreview({
  template,
  backHref,
  importAction,
  t,
  diverT,
  depthUnit,
}: {
  template: GlobalDiveSiteTemplateRow;
  backHref: string;
  // i18n-exempt: type annotation, not copy.
  importAction: (formData: FormData) => void | Promise<void>;
  t: StaffTranslator;
  /** The field guide is diver copy; the preview shows it as a diver will read it. */
  diverT: DiverTranslator;
  /** The shop's own unit: the catalog stores metres and reads the way the imported site will. */
  depthUnit: DepthUnit;
}) {
  const briefing = template.version.briefing;
  const depth = staffDiveSiteDepthText(t, briefing, depthUnit);
  // Resolved for the reader, exactly as the imported site's own briefing will
  // render it -- the preview's whole job is showing what you are about to take.
  const templateDifficulty = diveSiteDifficultyLabel(briefing.difficultyLevel, diverT);
  const species = (briefing.creatureSlugs ?? [])
    .filter(isMarineLifeSlug)
    .map((slug) => marineLifeCard(slug, diverT));
  const facts: Array<{ label: string; value: string }> = [
    briefing.locationName
      ? { label: t("diveSites.catalog.preview_location"), value: briefing.locationName }
      : null,
    depth ? { label: t("diveSites.catalog.preview_depth"), value: depth } : null,
    // Resolved for the reader, like the field guide below it: an older
    // published version holds free text here, a newer one a code, and both
    // narrow to the same three readings.
    templateDifficulty
      ? { label: t("diveSites.catalog.preview_difficulty"), value: templateDifficulty }
      : null,
    briefing.currentNote
      ? { label: t("diveSites.catalog.preview_conditions"), value: briefing.currentNote }
      : null,
  ].filter((fact) => fact !== null);

  return (
    <StaffPage>
      <div>
        <ShopPageHeader
          eyebrow={t("diveSites.catalog.backToCatalog")}
          eyebrowHref={backHref}
          title={briefing.name}
          description={briefing.description ?? ""}
          actions={
            <form action={importAction}>
              <input type="hidden" name="templateId" value={template.template.id} />
              <SubmitButton
                pendingLabel={t("diveSites.catalog.importing")}
                className={buttonClass()}
              >
                {t("diveSites.catalog.importToLibrary")}
              </SubmitButton>
            </form>
          }
        />
      </div>

      {facts.length > 0 ? (
        <dl className={sectionCardClass({ className: "mt-6 grid gap-4 sm:grid-cols-2" })}>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className={groupLabelClass()}>{fact.label}</dt>
              <dd className="mt-1 text-sm font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {briefing.minimumCertificationLevel ||
      briefing.requiresNitrox ||
      (briefing.requiredSpecialties?.length ?? 0) > 0 ? (
        // Framed like the facts panel above it, and for a reason worth stating:
        // those are prose a shop can rewrite, these are the gates that decide
        // who may board. On the one screen answering "what am I adopting", the
        // gates may not read quieter than the description — which is what
        // happened the moment the facts list became a raised card.
        <section className={sectionCardClass({ className: "mt-6" })}>
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_requirements")}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {briefing.minimumCertificationLevel ? (
              <Badge tone="primary" size="sm">
                {t(CERTIFICATION_LEVEL_KEYS[briefing.minimumCertificationLevel])}
              </Badge>
            ) : null}
            {(briefing.requiredSpecialties ?? []).map((specialty) => (
              <Badge key={specialty} tone="neutral" size="sm">
                {t(SPECIALTY_KEYS[specialty])}
              </Badge>
            ))}
            {briefing.requiresNitrox ? (
              <Badge tone="warning" size="sm">
                {t("diveSites.list.nitroxBadge")}
              </Badge>
            ) : null}
          </div>
        </section>
      ) : null}

      {briefing.fitNote ? (
        // A card in a tone (`TONE_PANEL_CLASS`), under the facts and gates
        // cards: at a hand-rolled `p-5` with no bed, its words sat 4px inside
        // theirs on a phone. It keeps its lagoon fill, with the tone's hairline.
        <section className={`mt-6 ${TONE_PANEL_CLASS} border-primary/30 bg-primary-tint`}>
          <h2 className={`${SECTION_TITLE_CLASS} text-primary`}>
            {t("diveSites.catalog.preview_fit")}
          </h2>
          <p className="mt-1 text-sm text-muted">{briefing.fitNote}</p>
        </section>
      ) : null}

      {briefing.divePlan ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_divePlan")}
          </h2>
          <p className="mt-2 leading-relaxed text-muted">{briefing.divePlan}</p>
        </section>
      ) : null}

      {briefing.marineLifeDescription ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_underwater")}
          </h2>
          <p className="mt-2 leading-relaxed text-muted">{briefing.marineLifeDescription}</p>
        </section>
      ) : null}

      {(briefing.landmarks?.length ?? 0) > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_landmarks")}
          </h2>
          <ul
            className={sectionCardClass({
              padding: "none",
              className: "mt-2 divide-y divide-border overflow-hidden",
            })}
          >
            {(briefing.landmarks ?? []).map((landmark) => (
              <li key={landmark.name} className="px-4 py-3">
                <p className="font-medium">{landmark.name}</p>
                {landmark.note ? (
                  <p className="mt-0.5 text-sm text-muted">{landmark.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {species.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_fieldGuide")}
          </h2>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4">
            {species.map((entry) => (
              <li key={entry.slug}>
                {/* 25vw was a lie about this grid. The enclosing <main> is
                    `max-w-3xl` (768px) less `sm:px-6` (48px), so four columns
                    and their three `gap-x-3` gaps leave 171px a cell — never a
                    quarter of the viewport. On a 1920px screen 25vw resolved to
                    480px and the browser duly fetched a 960px candidate for a
                    slot that can show 342. 180px keeps headroom over 171 and
                    still lands on a 384px candidate at DPR2. */}
                <StoredPhoto
                  // The same 171px cell as the trip pitch's faces, so the same
                  // latent decode flip; capture-only rewrite, see
                  // `src/lib/marine-life-tiles.ts`.
                  src={capturePhoto(entry.imageUrl, 171)}
                  alt={entry.name}
                  className="aspect-[4/3] w-full rounded-lg bg-surface-sunken"
                  sizes="(min-width: 640px) 180px, 50vw"
                />
                <p className="mt-1.5 text-sm font-medium leading-tight">{entry.name}</p>
                <p className="text-xs text-muted">{entry.kind}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </StaffPage>
  );
}
