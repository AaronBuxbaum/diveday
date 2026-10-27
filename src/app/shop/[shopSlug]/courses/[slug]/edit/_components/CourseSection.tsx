import type { ReactNode } from "react";
import type { EditorSectionRef } from "@/components/editor/EditorSection";
import {
  ClosedEditorSection,
  OpenEditorSection,
} from "../../../../dive-sites/_components/EditorSections";

/**
 * One section of the course editor, as the page placed it: open for what a
 * course page is edited for, or closed behind its name (visual review
 * 2026-10-24, A11). The page decides which, on the section's ref.
 */
export type CourseSectionRef = EditorSectionRef & {
  /** Closed behind a disclosure that names it. */
  closed?: boolean;
  printEditorLabel?: string;
  /** For a closed section: opened by a refusal or notice about it. */
  open?: boolean;
};

export function CourseSection({
  id,
  label,
  unsavedTag,
  closed = false,
  open,
  description,
  as = "section",
  lead = false,
  children,
  printEditorLabel,
}: CourseSectionRef & {
  description?: ReactNode;
  as?: "section" | "fieldset";
  /** The first open section, with no rule above it. */
  lead?: boolean;
  children: ReactNode;
}) {
  return closed ? (
    <ClosedEditorSection
      id={id}
      printEditorLabel={printEditorLabel}
      label={label}
      description={description}
      grouped={as === "fieldset"}
      open={open}
    >
      {children}
    </ClosedEditorSection>
  ) : (
    <OpenEditorSection
      id={id}
      label={label}
      description={description}
      grouped={as === "fieldset"}
      first={lead}
      unsavedTag={unsavedTag}
    >
      {children}
    </OpenEditorSection>
  );
}
