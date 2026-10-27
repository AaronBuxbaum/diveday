import type { ReactNode } from "react";
import { EditorSection } from "@/components/editor/EditorSection";
import { DisclosureRow } from "@/components/ui/disclosure";

/**
 * **A long-form editor's two kinds of section** (visual review 2026-10-24,
 * A11), shared by the dive-site and course editors: the few a page is edited
 * for stand open on hairlines, and every other one is closed behind a
 * disclosure that carries its name alone. Both keep the section's id on the
 * element that holds its controls, which is what the unsaved-changes sentence
 * traces an edit back to and what a `#fragment` opens.
 */
export function OpenEditorSection({
  id,
  label,
  description,
  grouped = false,
  first = false,
  unsavedTag,
  children,
}: {
  id: string;
  label: string;
  description?: ReactNode;
  /** A run of controls that genuinely is one group announces itself as one. */
  grouped?: boolean;
  /** The first section opens with no rule above it. */
  first?: boolean;
  unsavedTag?: string;
  children: ReactNode;
}) {
  return (
    // `lead` on every open section, so it stands open on a phone as well;
    // the hairline between two of them is this wrapper's.
    <div className={first ? undefined : "border-t border-border pt-6"}>
      <EditorSection
        id={id}
        label={label}
        description={description}
        as={grouped ? "fieldset" : "section"}
        lead
        unsavedTag={unsavedTag}
      >
        {children}
      </EditorSection>
    </div>
  );
}

/**
 * A closed section: one row of the page's `DisclosureRowList`, its summary
 * the section's name and nothing else. The controls stay in the form while
 * it is shut, so what was typed in them still posts with Save.
 */
export function ClosedEditorSection({
  id,
  label,
  description,
  grouped = false,
  open,
  children,
  printEditorLabel,
}: {
  id: string;
  label: string;
  description?: ReactNode;
  grouped?: boolean;
  /** Opened by the page when a refusal or a notice is about this section. */
  open?: boolean;
  children: ReactNode;
  printEditorLabel?: string;
}) {
  const body = (
    <div className="flex flex-col gap-5">
      {printEditorLabel ? (
        <p className="hidden text-sm font-medium print:block">{printEditorLabel}</p>
      ) : null}
      {description ? <div className="text-sm text-muted">{description}</div> : null}
      {children}
    </div>
  );
  return (
    <DisclosureRow id={id} heading={label} open={open}>
      {grouped ? (
        <fieldset className="min-w-0">
          <legend className="sr-only">{label}</legend>
          {body}
        </fieldset>
      ) : (
        body
      )}
    </DisclosureRow>
  );
}
