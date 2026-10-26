import type { ReactNode } from "react";
import { StoredPhoto } from "@/components/StoredPhoto";
import { isMarineLifeSlug, type MarineLifeSlug } from "@/db/marine-life-catalog";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import type { DiverTranslator } from "@/i18n/messages";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type DepthUnit, depthInUnit } from "@/lib/depth-units";
import type { DiveSiteTemplateDiff } from "@/lib/dive-site-template-sync";
import { cachedFormatter, cachedListFormat } from "@/lib/intl-cache";
import { TEMPLATE_FIELD_KEYS } from "./template-field-keys";

/** Compare actual typed values inside the existing replacement door; preserved fields say so. */
export function TemplateValueComparison({
  changes,
  fieldGuideOn,
  depthUnit,
  locale,
  t,
  diverT,
}: {
  changes: readonly DiveSiteTemplateDiff[];
  fieldGuideOn: boolean;
  depthUnit: DepthUnit;
  locale: string;
  t: StaffTranslator;
  diverT: DiverTranslator;
}) {
  const empty = t("diveSites.edit.templateUpdates.empty");
  const value = (
    field: DiveSiteTemplateDiff["field"],
    content: DiveSiteTemplateDiff["current"],
  ): ReactNode => {
    if (content === null || content === "" || (Array.isArray(content) && content.length === 0))
      return <span className="text-muted">{empty}</span>;
    if (typeof content === "boolean")
      return t(content ? "diveSites.form.snorkelYes" : "diveSites.form.snorkelNo");
    if (field === "landmarks" && Array.isArray(content))
      return (
        <ul className="space-y-3">
          {content.map((landmark, index) =>
            typeof landmark === "object" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: immutable version comparison rows have no editable local state and may share names
              <li key={`${landmark.name}-${index}`}>
                <p className="font-medium">{landmark.name}</p>
                <p className="text-muted">{t(`diveSites.form.landmarks.kinds.${landmark.kind}`)}</p>
                {landmark.note ? <p className="whitespace-pre-wrap">{landmark.note}</p> : null}
                {landmark.photoUrl ? (
                  <StoredPhoto
                    src={landmark.photoUrl}
                    alt={landmark.name}
                    className="mt-2 aspect-video rounded-lg"
                    sizes="(max-width: 640px) 90vw, 320px"
                  />
                ) : null}
              </li>
            ) : null,
          )}
        </ul>
      );
    if (field === "creatures" && Array.isArray(content))
      return cachedListFormat(locale).format(
        content
          .filter(
            (slug): slug is MarineLifeSlug => typeof slug === "string" && isMarineLifeSlug(slug),
          )
          .map((slug) => marineLifeCard(slug, diverT).name),
      );
    if (field === "requiredSpecialties" && Array.isArray(content))
      return cachedListFormat(locale).format(
        content
          .filter(
            (specialty): specialty is keyof typeof SPECIALTY_KEYS =>
              typeof specialty === "string" && Object.hasOwn(SPECIALTY_KEYS, specialty),
          )
          .map((specialty) => t(SPECIALTY_KEYS[specialty])),
      );
    if (
      field === "minimumCertificationLevel" &&
      typeof content === "string" &&
      Object.hasOwn(CERTIFICATION_LEVEL_KEYS, content)
    )
      return t(CERTIFICATION_LEVEL_KEYS[content as keyof typeof CERTIFICATION_LEVEL_KEYS]);
    if (
      field === "difficultyLevel" &&
      (content === "beginner" || content === "intermediate" || content === "advanced")
    )
      return diveSiteDifficultyLabel(content, diverT);
    if (field === "fitTone") {
      return t(
        content === "welcoming"
          ? "diveSites.form.fitToneWelcoming"
          : content === "demanding"
            ? "diveSites.form.fitToneDemanding"
            : "diveSites.form.fitToneAskCrew",
      );
    }
    if (typeof content === "number") {
      if (field === "depthMinMeters" || field === "maxDepthMeters")
        return t(
          depthUnit === "feet"
            ? "diveSites.form.depthPreviewFeetOne"
            : "diveSites.form.depthPreviewMetersOne",
          { value: depthInUnit(content, depthUnit) },
        );
      if (field === "expectedBottomTimeMinutes")
        return t("diveSites.edit.templateUpdates.minutes", { count: content });
      return cachedFormatter("number", Intl.NumberFormat, locale, {
        maximumFractionDigits: 6,
      }).format(content);
    }
    return typeof content === "string" ? content : empty;
  };

  return (
    <ul className="mt-4 space-y-5 text-sm">
      {changes.map((change) => {
        // The current DB writer preserves conservationNote; guide-off fields also stay local.
        const kept =
          change.field === "conservationNote" ||
          (!fieldGuideOn &&
            (change.field === "creatures" || change.field === "fieldGuideTipsHeading"));
        return (
          <li key={change.field} className="border-t border-border pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{t(TEMPLATE_FIELD_KEYS[change.field])}</h3>
              <span className="text-xs text-muted">
                {t(
                  kept
                    ? "diveSites.edit.templateUpdates.kept"
                    : change.shopChanged
                      ? "diveSites.edit.templateUpdates.shopEdit"
                      : "diveSites.edit.templateUpdates.templateChange",
                )}
              </span>
            </div>
            <dl className="mt-2 grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="mb-1 text-xs font-medium text-muted">
                  {t("diveSites.edit.templateUpdates.current")}
                </dt>
                <dd className="text-base whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {value(change.field, change.current)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="mb-1 text-xs font-medium text-muted">
                  {t("diveSites.edit.templateUpdates.template")}
                </dt>
                <dd className="text-base whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {value(change.field, change.latest)}
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
