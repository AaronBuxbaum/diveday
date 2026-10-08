import { EditorSection, type EditorSectionRef } from "@/components/editor/EditorSection";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_LEARNING_MATERIALS } from "@/lib/course-limits";
import { readLearningMaterials } from "@/lib/courses";
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
  section: EditorSectionRef;
  /** `courses.learning_materials` as stored; read through `readLearningMaterials`. */
  stored: unknown;
  storageKey: string;
  t: StaffTranslator;
}) {
  return (
    <EditorSection
      id={section.id}
      label={section.label}
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
    </EditorSection>
  );
}
