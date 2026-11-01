"use client";

import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupLabelClass } from "@/components/ui/group-label";
import { EDITOR_REVEAL_EVENT } from "@/components/ui/reveal-event";

/** A long-form editor section and its rail entry (ADR 20260827-the-shops-shelves). */
export type EditorSectionRef = {
  /** The section element's id and the rail's #anchor. */
  id: string;
  /** Already translated; staff copy is resolved on the server. */
  label: string;
  /** The phone header's unsaved word. */
  unsavedTag?: string;
};

/** Pre-translated unsaved-change sentences; pluralisation stays in staff copy (AGENTS.md). */
export type EditorUnsavedCopy = {
  /** One sentence per section, in rail order. */
  inSection: readonly string[];
  /** One sentence per dirty-section count; indices 2 and up are read. */
  inSections: readonly string[];
};

/**
 * A section of a long-form editor: a group label, an optional line of
 * consequence under it, and the fields themselves — sitting on the page rather
 * than in a box.
 *
 * Long-form editor pattern from ADR 20260827-the-shops-shelves: unboxed
 * sections use group labels and hairlines. A fieldset keeps its semantics;
 * its legend can sit on the hairline without a border.
 *
 * `as="fieldset"` for a run of controls that genuinely is one group — the route
 * a shop draws, its landmarks, its field guide, its certification demands —
 * because a screen reader then announces the group's name with every control
 * inside it. `as="section"` (the default) for a stretch of independent fields,
 * where a `<fieldset>` would prefix every label with a name that only some of
 * them share.
 *
 * `scroll-mt-6` adds local spacing; `html`'s global scroll padding already
 * clears the chrome bar (#1941; ADR 20260827-clearwater-surface-language,
 * decision 10). Adding the bar height here would double the offset.
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

  // Separate sections, but leave the first clear; phone headers provide their own air.
  const rule = lead ? "" : " border-t border-border lg:pt-6";
  // Used to trace edited controls back to their section and reveal it by id.
  const marker = { "data-editor-section": id, "data-open": open ? "" : undefined };
  // Keep controls mounted so folded values still submit. Folding is phone-only
  // (#2439); desktop keeps every section open beside the rail.
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
          // The previous section may have folded; restore this header below the chrome.
          requestAnimationFrame(() => rootRef.current?.scrollIntoView?.({ block: "start" }));
        }}
        className="flex min-h-12 w-full items-center gap-3 rounded-lg py-3 text-start focus-visible:focus-ring lg:hidden"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Keep the unsaved state in the button's accessible name (#2438). */}
          <span className="flex items-center gap-2">
            <span>{label}</span>
            {edited && unsavedTag ? (
              <Badge size="sm" className="tracking-normal normal-case">
                {unsavedTag}
              </Badge>
            ) : null}
          </span>
          {/* Preview the section's own fields; reserve height until hydration. */}
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
      // Put the rule on the full-width legend: a borderless fieldset starts its
      // legend at the top, matching section geometry (ADR 20260827-the-shops-shelves).
      // Keep id and marker on the named group: ?field= and FieldErrorFocus target it.
      // Name only the label; the legend also contains the phone header and preview.
      <fieldset
        ref={(element) => {
          rootRef.current = element;
        }}
        id={id}
        {...marker}
        aria-labelledby={labelId}
        className="min-w-0 scroll-mt-6"
      >
        {/* A fieldset's first child must be legend; use the class on that element. */}
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
 * Layout effects install reveal listeners and open URL targets before passive
 * effects such as FieldErrorFocus move focus.
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

    // Reveal synchronously before browser validation or FieldErrorFocus moves focus.
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

    // Open a section named by ?field= before focus moves.
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
    // `invalid` does not bubble; capture it on the way down.
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
 * The first two populated controls, in page order, as staff-entered text.
 * Selects use their option labels, checkboxes their labels; paired controls
 * use their range/one-value templates. Drawn routes and photo grids stay blank.
 */
export function sectionPreview(body: Element): string {
  const parts: string[] = [];
  const paired = new Set<string>();
  for (const control of body.querySelectorAll("input, textarea, select")) {
    let text = "";
    const pair = control.getAttribute("data-preview-pair");
    if (pair) {
      if (paired.has(pair)) continue;
      paired.add(pair);
      text = pairedPreview(body.querySelectorAll(`[data-preview-pair="${pair}"]`));
      if (text) parts.push(text);
      if (parts.length === 2) break;
      continue;
    }
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

function pairedPreview(controls: NodeListOf<Element>): string {
  const [first, second] = [...controls].map((c) => (c as HTMLInputElement).value.trim());
  if (!first && !second) return "";
  const fill = (template: string | null | undefined, values: Record<string, string>) =>
    (template ?? "").replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
  if (first && second)
    return fill(controls[0]?.getAttribute("data-preview-range"), { min: first, max: second });
  return fill(controls[0]?.getAttribute("data-preview-one"), { value: first || second });
}

function SectionDescription({ children, hidden }: { children: ReactNode; hidden: boolean }) {
  return (
    <p className={`mt-2 max-w-2xl text-sm text-muted${hidden ? " max-lg:hidden" : ""}`}>
      {children}
    </p>
  );
}
