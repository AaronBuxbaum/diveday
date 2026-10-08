import { SettledCheck } from "@/components/ui/SettledCheck";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { DiverTranslator } from "@/i18n/messages";
import { type CourseLearningMaterial, isLearningMaterialLink } from "@/lib/courses";

/**
 * What a course asks a student to work through before day 1, on the thread
 * (ADR 20261008-course-learning-materials). The same list the confirmation
 * email carried, so a diver who lost the email still has it here.
 *
 * Each link leaves with `rel="noreferrer"`: this page's URL is a bearer
 * capability, and a referrer header would hand it to the agency's site.
 *
 * Once the shop has marked the materials done the list stays, under one
 * settled line, because a diver may still want the links back.
 */
export function CourseMaterials({
  materials,
  done,
  t,
}: {
  materials: CourseLearningMaterial[];
  done: boolean;
  t: DiverTranslator;
}) {
  if (materials.length === 0) return null;
  return (
    <section aria-labelledby="course-materials-heading">
      <h2 id="course-materials-heading" className={SECTION_TITLE_CLASS}>
        {t("notifications.courseMaterials.heading")}
      </h2>
      {done ? (
        <p className="mt-2">
          <SettledCheck settled label={t("ready.materialsDone")} className="text-sm text-muted" />
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {materials.map((material, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the shop's order is the identity; names may repeat.
          <li key={index} className="text-base">
            {material.url && isLearningMaterialLink(material.url) ? (
              <a
                href={material.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                {material.name}
              </a>
            ) : (
              <span className="font-medium">{material.name}</span>
            )}
            {material.note ? <span className="text-muted"> · {material.note}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
