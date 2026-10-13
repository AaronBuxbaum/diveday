import type { DiverTranslator } from "@/i18n/messages";

/**
 * **The instructor's next step, while the course is still running** (third UX
 * review, item 15). The recap prints the same quote once the boat is home; a
 * note written after day one ("Practice mask clearing before Sunday") is for
 * before day two, so the live thread shows it under the spine's "Next".
 *
 * The instructor's own words under their own name, the recap's two keys, and
 * nothing when there is no note.
 */
export function CourseNextStepNote({
  note,
  t,
}: {
  note: { words: string; byName: string } | null;
  t: DiverTranslator;
}) {
  if (!note) return null;
  return (
    <figure className="mt-6 border-s-2 border-border ps-4">
      <blockquote className="text-base leading-relaxed text-pretty">
        {t("recap.course.nextStepQuote", { words: note.words })}
      </blockquote>
      <figcaption className="mt-2 text-sm text-muted">
        {t("recap.course.nextStepBy", { name: note.byName })}
      </figcaption>
    </figure>
  );
}
