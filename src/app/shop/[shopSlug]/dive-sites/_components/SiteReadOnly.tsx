import { GroupLabel } from "@/components/ui/group-label";
import type { diveSites } from "@/db/schema";
import { staffDiveSiteDepthText } from "@/i18n/depth-labels";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import type { DiverTranslator } from "@/i18n/messages";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";

/**
 * **The site as a crew member reads it.** Editing the library is owner and
 * manager work, so everyone else gets the briefing to read and the departure
 * to schedule: no form, and no sentence about what they cannot do.
 */
export function SiteReadOnly({
  site,
  shopDepthUnit,
  t,
  diverT,
}: {
  site: typeof diveSites.$inferSelect;
  shopDepthUnit: DepthUnit;
  t: StaffTranslator;
  diverT: DiverTranslator;
}) {
  const facts = [
    { label: t("diveSites.form.locationLabel"), value: site.locationName },
    {
      label: t("diveSites.form.difficultyLabel"),
      value: diveSiteDifficultyLabel(site.difficultyLevel, diverT),
    },
    {
      label: t(
        shopDepthUnit === "feet"
          ? "diveSites.form.maxDepthFeetLabel"
          : "diveSites.form.maxDepthMetersLabel",
      ),
      value: staffDiveSiteDepthText(t, site, shopDepthUnit),
    },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));
  const notes = [
    { label: t("diveSites.form.descriptionLabel"), value: site.description },
    { label: t("diveSites.form.divePlanLabel"), value: site.divePlan },
    { label: t("diveSites.form.currentNoteLabel"), value: site.currentNote },
  ].filter((note): note is { label: string; value: string } => Boolean(note.value));
  return (
    <section className="mt-8 space-y-6">
      {facts.length > 0 ? (
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>
                <GroupLabel>{fact.label}</GroupLabel>
              </dt>
              <dd className="mt-1">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {notes.map((note) => (
        <div key={note.label}>
          <GroupLabel as="h2">{note.label}</GroupLabel>
          <p className="mt-1 whitespace-pre-line text-muted">{note.value}</p>
        </div>
      ))}
    </section>
  );
}
