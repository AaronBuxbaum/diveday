import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_LEARNING_MATERIALS } from "@/lib/course-limits";
import { readLearningMaterials } from "@/lib/courses";
import { CourseSection, type CourseSectionRef } from "./CourseSection";
import { LearningMaterialsEditor } from "./LearningMaterialsEditor";

/**
 * The editor's "Learning materials" section (ADR 20261008-course-learning-materials):
 * the stored list, read defensively, handed to the client editor with its words.
 */
export function LearningMaterialsSection({
  section,
  stored,
  storageKey,
  t,
}: {
  section: CourseSectionRef;
  /** `courses.learning_materials` as stored; read through `readLearningMaterials`. */
  stored: unknown;
  storageKey: string;
  t: StaffTranslator;
}) {
  return (
    <CourseSection
      unsavedTag={t("shared.formDraft.unsavedSection")}
      {...section}
      as="fieldset"
      description={t("courses.edit.materialsDescription")}
    >
      <LearningMaterialsEditor
        initialMaterials={readLearningMaterials(stored)}
        storageKey={storageKey}
        copy={{
          nameLabel: t.raw("courses.materials.nameLabel"),
          namePlaceholder: t("courses.materials.namePlaceholder"),
          linkLabel: t("courses.materials.linkLabel"),
          linkHint: t("courses.materials.linkHint"),
          noteLabel: t("courses.materials.noteLabel"),
          notePlaceholder: t("courses.materials.notePlaceholder"),
          remove: t.raw("courses.materials.remove"),
          add: t("courses.materials.add"),
          max: t("courses.materials.max", { max: MAX_LEARNING_MATERIALS }),
          empty: t("courses.materials.empty"),
        }}
      />
    </CourseSection>
  );
}
