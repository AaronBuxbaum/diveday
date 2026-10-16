"use client";

import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupLabelClass } from "@/components/ui/group-label";
import { EDITOR_REVEAL_EVENT } from "@/components/ui/reveal-event";

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
  /** The phone header's unsaved word; spread onto `EditorSection` with the rest. */
  unsavedTag?: string;
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
 * `scroll-mt` is a little air, and no longer the bar's height as well: an
 * anchor jump has to land the group label *below* the bar rather than behind
 * it (`ChromeBar`, ADR 20260827-clearwater-surface-language decision 10 — the
 * height is read, never measured), and since #1941 `globals.css` clears the
 * bar for every scroll in the app with one `scroll-padding-top` on `html`.
 * Scroll padding and scroll margin add, so keeping `--chrome-h` here as well
 * would land this label a whole bar's height too low.
 */
export function EditorSection({
  id,
  label,
  description,
  as = "section",
  lead = false,
  unsavedTag,
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
  /** The word the phone's header wears while the section holds unsaved edits. */
  unsavedTag?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(lead);
  // `null` until the wiring has read the fields once (after hydration), so
  // the line can say it is ready: the visual suite waits on that (#2509).
  const [preview, setPreview] = useState<string | null>(null);
  // Edited since the page loaded or the form last saved: dirty once, it
  // stays dirty, as the sentence beside Save does (`useDirtySections`).
  const [edited, setEdited] = useState(false);
  const labelId = `${id}-label`;
  const bodyId = `${id}-body`;

  // Opening is the one move that closes the others: a header tap or a jump to
  // the section. A refused control opening its own section does not, because
  // two sections can each hold one and the browser wants both visible.
  const openAlone = useCallback(() => {
    setOpen(true);
    document.dispatchEvent(new CustomEvent(EDITOR_SECTION_OPEN_EVENT, { detail: id }));
  }, [id]);

  useSectionWiring({ id, rootRef, bodyRef, setOpen, setPreview, setEdited, openAlone });

  // Hairlines between, never above the first: the rule separates two sections,
  // and a rule under the page header separates nothing. Below `lg` the header
  // is a 48px button that carries its own air, so the rule's `pt-6` is a
  // desktop measure only.
  const rule = lead ? "" : " border-t border-border lg:pt-6";
  // The attribute the unsaved-note hook traces a typed control back to, and
  // the one thing that makes a section findable without knowing its id. Written
  // out rather than spread from a constant so JSX keeps its typing.
  const marker = { "data-editor-section": id, "data-open": open ? "" : undefined };
  // **Hidden, never unmounted.** A closed section's controls stay in the form,
  // so what was typed in them survives the fold and still posts with Save; the
  // fold is a class below `lg`, where the rail no longer fits, and from `lg` up
  // every section stands open beside the rail as it always has.
  // **Phone-only on purpose** (Aaron, 2026-10-13, issue #2439): the review's height
  // numbers were phone heights, and on a wide screen the rail already tells a
  // reader where they are. Revisit if desktop users report losing their place.
  const body = (
    <div
      ref={bodyRef}
      id={bodyId}
      className={`mt-4 flex flex-col gap-5 max-lg:mb-6${open ? "" : " max-lg:hidden"}`}
    >
      {children}
    </div>
  );
  const heading = (
    <>
      <span id={labelId} className="max-lg:hidden">
        {label}
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          if (open) return setOpen(false);
          openAlone();
          // The section above may just have folded, which moves this one up
          // under the chrome bar: bring its header back to the top.
          requestAnimationFrame(() => rootRef.current?.scrollIntoView?.({ block: "start" }));
        }}
        className="flex min-h-12 w-full items-center gap-3 rounded-lg py-3 text-start focus-visible:focus-ring lg:hidden"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {/* **Where the edits are**, on the folded header a staffer scans
              (#2438). Inside the button, so its name says it too. */}
          <span className="flex items-center gap-2">
            <span>{label}</span>
            {edited && unsavedTag ? (
              <Badge size="sm" className="tracking-normal normal-case">
                {unsavedTag}
              </Badge>
            ) : null}
          </span>
          {/* The line under a folded section's name says what is in it, read
              off its own fields; the space is kept while it is empty so the
              row does not grow when the page wakes up. */}
          <span
            data-section-preview=""
            data-preview-ready={preview === null ? undefined : ""}
            className="block h-5 truncate text-sm font-normal tracking-normal text-muted normal-case"
          >
            {open ? "" : (preview ?? "")}
          </span>
        </span>
        <DisclosureCaret
          direction="down"
          className={`size-4 text-muted ${open ? "rotate-180" : ""}`}
        />
      </button>
    </>
  );
  const describe =
    description == null ? null : (
      <SectionDescription hidden={!open}>{description}</SectionDescription>
    );
  if (as === "fieldset") {
    return (
      // The rule and its air go on the legend, full width, and never on the
      // fieldset. A fieldset draws its `<legend>` in its own top border, so on
      // the fieldset they put the label on the hairline and the 24px between
      // the label and its fields: 27–28px above the label and 40px under it,
      // where a section's label sits 29px under its rule. A borderless
      // fieldset sets its legend at its top, so a legend carrying the rule
      // draws the section's geometry exactly.
      //
      // The anchor and the marker sit on the fieldset itself, the named group:
      // the course editor's refused day-by-day save sends `?field=` with this
      // id, and `FieldErrorFocus` focuses what carries it. A box around the
      // fieldset took that focus with no role or name; the group says which
      // section to fix.
      //
      // Named by the label alone (`aria-labelledby`), not by the legend's
      // text: the legend also holds the phone's header button, whose preview
      // line is not the group's name.
      <fieldset
        ref={(element) => {
          rootRef.current = element;
        }}
        id={id}
        {...marker}
        aria-labelledby={labelId}
        className="min-w-0 scroll-mt-6"
      >
        {/* `<legend>` has to be the fieldset's first child, so the label is
            spelled with `groupLabelClass()` rather than `GroupLabel` — the one
            documented use of the exported class: the same spelling, on the
            element this element has to be. */}
        <legend className={`${groupLabelClass()} w-full${rule}`}>{heading}</legend>
        {describe}
        {body}
      </fieldset>
    );
  }
  return (
    <section
      ref={(element) => {
        rootRef.current = element;
      }}
      id={id}
      {...marker}
      aria-labelledby={labelId}
      className={`scroll-mt-6${rule}`}
    >
      <h2 className={groupLabelClass()}>{heading}</h2>
      {describe}
      {body}
    </section>
  );
}

/** Announced on the document when a section opens by itself; the rest fold. */
const EDITOR_SECTION_OPEN_EVENT = "editor-section-open";

/**
 * Everything that opens a folded section without its header being tapped,
 * and the preview line a folded one shows.
 *
 * **Layout effects, on purpose.** They run before any component's passive
 * effect in the same commit, so a section is listening (and has already opened
 * for the URL's `#hash` or `?field=`) by the time `FieldErrorFocus` moves the
 * cursor.
 */
function useSectionWiring({
  id,
  rootRef,
  bodyRef,
  setOpen,
  setPreview,
  setEdited,
  openAlone,
}: {
  id: string;
  rootRef: { current: HTMLElement | null };
  bodyRef: { current: HTMLDivElement | null };
  setOpen: (open: boolean) => void;
  setPreview: (preview: string) => void;
  setEdited: (edited: boolean) => void;
  openAlone: () => void;
}) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;

    // The DOM is shown at once and the state follows: the browser's own
    // validation and `FieldErrorFocus` both focus straight after telling us,
    // and neither can wait for a render.
    const reveal = () => {
      body.classList.remove("max-lg:hidden");
      setOpen(true);
    };
    const holds = (target: string | null) => {
      if (!target) return false;
      const element = document.getElementById(target);
      return element !== null && root.contains(element);
    };
    const jump = (target: string | null) => {
      if (!holds(target)) return;
      reveal();
      openAlone();
      requestAnimationFrame(() => root.scrollIntoView?.({ block: "start" }));
    };

    const onOtherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    const onHashChange = () => jump(decodeFragment(window.location.hash.slice(1)));
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      const href = link?.getAttribute("href");
      if (href?.startsWith("#")) jump(decodeFragment(href.slice(1)));
    };
    const refreshPreview = () => setPreview(sectionPreview(body));
    const onEdit = () => {
      setEdited(true);
      refreshPreview();
    };
    // Saving is the one thing that makes the section clean again.
    const form = root.closest("form");
    const onSubmit = () => setEdited(false);

    // Arriving at an address that names something in here.
    const field = new URLSearchParams(window.location.search).get("field");
    if (holds(field)) {
      reveal();
      openAlone();
    }
    onHashChange();
    refreshPreview();

    document.addEventListener(EDITOR_SECTION_OPEN_EVENT, onOtherOpened);
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHashChange);
    root.addEventListener(EDITOR_REVEAL_EVENT, reveal);
    // `invalid` does not bubble, so it is heard on the way down.
    root.addEventListener("invalid", reveal, true);
    root.addEventListener("input", onEdit, true);
    root.addEventListener("change", onEdit, true);
    form?.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener(EDITOR_SECTION_OPEN_EVENT, onOtherOpened);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", onHashChange);
      root.removeEventListener(EDITOR_REVEAL_EVENT, reveal);
      root.removeEventListener("invalid", reveal, true);
      root.removeEventListener("input", onEdit, true);
      root.removeEventListener("change", onEdit, true);
      form?.removeEventListener("submit", onSubmit);
    };
  }, [id, rootRef, bodyRef, setOpen, setPreview, setEdited, openAlone]);
}

/**
 * A `#fragment` as the id it names. A malformed escape (`#%E0%A4%A`) is kept
 * as typed rather than thrown: thrown inside the layout effect, it took every
 * section's wiring down with it, and no id is spelled that way anyway.
 */
function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** Controls whose value is words a person typed or picked. */
const PREVIEW_INPUT_TYPES = new Set([
  "",
  "text",
  "email",
  "url",
  "tel",
  "search",
  "number",
  "date",
  "time",
  "datetime-local",
]);

/**
 * **What a folded section holds**, in its own words: the first two of its
 * fields that have something in them, in page order, joined by a middle dot.
 * A pick list says the option's words, never its code; a ticked box, its label.
 *
 * Read off the section's own controls, so there is nothing per section to keep
 * in step with the fields, and nothing to translate: it is the shop's text.
 * A section whose content is a drawn route or a photo grid says nothing here
 * rather than guess.
 */
export function sectionPreview(body: Element): string {
  const parts: string[] = [];
  for (const control of body.querySelectorAll("input, textarea, select")) {
    let text = "";
    if (control instanceof HTMLSelectElement) {
      if (control.value !== "") text = control.selectedOptions[0]?.textContent ?? "";
    } else if (control instanceof HTMLTextAreaElement) {
      text = control.value;
    } else if (control instanceof HTMLInputElement) {
      if (PREVIEW_INPUT_TYPES.has(control.getAttribute("type") ?? "")) text = control.value;
      // A ticked box says its label: a folded Certification section's demands
      // are boxes, and an empty preview read as a section with nothing in it.
      else if (control.type === "checkbox" && control.checked)
        text = control.labels?.[0]?.textContent ?? "";
    }
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed) parts.push(trimmed.length > 60 ? `${trimmed.slice(0, 60).trimEnd()}…` : trimmed);
    if (parts.length === 2) break;
  }
  return parts.join(" · ");
}

function SectionDescription({ children, hidden }: { children: ReactNode; hidden: boolean }) {
  return (
    <p className={`mt-2 max-w-2xl text-sm text-muted${hidden ? " max-lg:hidden" : ""}`}>
      {children}
    </p>
  );
}
