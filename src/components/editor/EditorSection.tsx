import type { ReactNode } from "react";
import { GroupLabel, groupLabelClass } from "@/components/ui/ledger";

/**
 * One section of a long-form editor, and the entry the rail beside it makes
 * for that section.
 *
 * ADR 20260827-the-shops-shelves, the long-form editor pattern: "a sticky
 * section rail beside unboxed sections — group labels and hairlines instead of
 * bordered fieldsets, the rail naming the sections and tracking position". The
 * `id` is both the anchor the rail links to and the DOM subtree the unsaved
 * note maps a control back to, so it is one fact, declared once, per section.
 */
export type EditorSectionRef = {
  /** The section element's `id`, and the rail's `#anchor`. */
  id: string;
  /** Already-translated: staff copy is resolved on the server. */
  label: string;
};

/**
 * The unsaved-changes sentences, resolved per outcome rather than templated.
 *
 * Which sections are dirty is client state and staff copy is server-side only,
 * so the sentences arrive pre-pluralised — the same shape `RouteEditorCopy`'s
 * `status` array takes, and for the same reason: a component interpolating
 * `{count}` itself would be pluralising in the one place a translator cannot
 * reach (AGENTS.md).
 */
export type EditorUnsavedCopy = {
  /** One sentence per section, in the rail's own order, naming that section. */
  inSection: readonly string[];
  /** One sentence per dirty-section count; only index 2 and up are ever read. */
  inSections: readonly string[];
};

/**
 * A section of a long-form editor: a group label, an optional line of
 * consequence under it, and the fields themselves — sitting on the page rather
 * than in a box.
 *
 * **The border is what this removes.** The dive-site form was fourteen blocks
 * wearing four bordered fieldsets at two radii, and the course editor eight —
 * the boxes-in-boxes composition `SectionCard`'s own documentation calls a
 * failure when nested. A `<legend>` on a hairline group label groups exactly as
 * well (ADR 20260827-the-shops-shelves, "Alternatives considered"), so the
 * `<fieldset>` stays for semantics and its border goes.
 *
 * `as="fieldset"` for a run of controls that genuinely is one group — the route
 * a shop draws, its landmarks, its field guide, its certification demands —
 * because a screen reader then announces the group's name with every control
 * inside it. `as="section"` (the default) for a stretch of independent fields,
 * where a `<fieldset>` would prefix every label with a name that only some of
 * them share.
 *
 * `scroll-mt` is `--chrome-h` plus a little air: an anchor jump has to land the
 * group label *below* the bar rather than behind it (`ChromeBar`, ADR
 * 20260827-clearwater-surface-language decision 10 — the height is read, never
 * measured).
 */
export function EditorSection({
  id,
  label,
  description,
  as = "section",
  lead = false,
  children,
}: {
  id: string;
  /** Already-translated section name; the rail says the same word. */
  label: string;
  /** One line the fields cannot say for themselves. Omitted far more often than not. */
  description?: ReactNode;
  as?: "section" | "fieldset";
  /** The first section of the form, which opens with no rule above it. */
  lead?: boolean;
  children: ReactNode;
}) {
  // Hairlines between, never above the first: the rule separates two sections,
  // and a rule under the page header separates nothing.
  const shell = `scroll-mt-[calc(var(--chrome-h)+1.5rem)] ${
    lead ? "" : "border-t border-border pt-6"
  }`.trim();
  // The attribute the unsaved-note hook traces a typed control back to, and
  // the one thing that makes a section findable without knowing its id. Written
  // out rather than spread from a constant so JSX keeps its typing.
  const marker = { "data-editor-section": id };
  const body = <div className="mt-4 flex flex-col gap-5">{children}</div>;
  if (as === "fieldset") {
    return (
      // `<legend>` has to be the fieldset's first child, so the label is
      // spelled with `groupLabelClass()` rather than `GroupLabel` — the one
      // documented use of the exported class: the same spelling, on the element
      // this element has to be.
      <fieldset id={id} {...marker} className={shell}>
        <legend className={groupLabelClass()}>{label}</legend>
        {description == null ? null : <SectionDescription>{description}</SectionDescription>}
        {body}
      </fieldset>
    );
  }
  return (
    <section id={id} {...marker} aria-labelledby={`${id}-label`} className={shell}>
      <GroupLabel as="h2" id={`${id}-label`}>
        {label}
      </GroupLabel>
      {description == null ? null : <SectionDescription>{description}</SectionDescription>}
      {body}
    </section>
  );
}

function SectionDescription({ children }: { children: ReactNode }) {
  return <p className="mt-2 max-w-2xl text-sm text-muted">{children}</p>;
}
