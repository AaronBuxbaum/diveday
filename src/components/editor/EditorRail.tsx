"use client";

import { useEffect, useState } from "react";
import { RAIL_ROW_CLASS, RAIL_ROW_IDLE } from "@/components/ui/rail";
import type { EditorSectionRef, EditorUnsavedCopy } from "./EditorSection";

/**
 * The rail's outer box, shared with `EditorRailSkeleton`: a column pinned
 * under the chrome bar from `lg` up, and nothing below it, where each
 * section's own folding header is the way to it (`EditorSection`).
 */
const RAIL_CLASS = "max-lg:hidden lg:sticky lg:top-(--chrome-h) lg:self-start lg:pt-1";

/** The list inside it, shared with `EditorRailSkeleton`. */
const RAIL_LIST_CLASS = "flex flex-col items-stretch gap-y-0.5";

/**
 * **Where you are in a long editor** — ADR 20260827-the-shops-shelves, the
 * long-form editor pattern: "a sticky section rail beside unboxed sections …
 * the rail naming the sections and tracking position."
 *
 * From `lg` up only. Below it the rail wrapped to four and five rows of pills
 * over a 7,000px form; there each section folds to a header that names it and
 * opens it, so the headers are the jump links and the rail would say them
 * twice. They are plain `#anchor` links the browser resolves itself, so the
 * rail works before this component's JavaScript arrives and cannot disturb a
 * form mid-edit.
 *
 * **`top-(--chrome-h)`, never a number.** The bar's height is a token
 * (ADR 20260827-clearwater-surface-language, decision 10) and
 * `src/components/chrome/chrome.test.ts` fails the build on a measured offset —
 * it caught exactly this mistake on the settings rail.
 *
 * The current entry is the *word* the section carries, tinted; there is no
 * second state word to add, because the rail says nothing a reader could get
 * wrong from the tint alone (it is a position, not a state).
 */
export function EditorRail({
  sections,
  navLabel,
}: {
  sections: readonly EditorSectionRef[];
  /** "On this page" — the accessible name for both renderings. */
  navLabel: string;
}) {
  const current = useCurrentSection(sections);
  return (
    <nav aria-label={navLabel} className={RAIL_CLASS}>
      <ul className={RAIL_LIST_CLASS}>
        {sections.map((section) => {
          const active = section.id === current;
          return (
            <li key={section.id} className="flex">
              {/* The page rail's one row, the settings rail's too
                  (`ui/rail.ts`), ringed inside itself.

                  Hover lives in each branch, not on every row: a bare
                  `hover:bg-surface-sunken` (`RAIL_ROW_IDLE`'s) outranked the
                  current row's `bg-primary-tint`, so the one tinted row went
                  grey under the pointer. */}
              <a
                href={`#${section.id}`}
                aria-current={active ? "true" : undefined}
                className={`${RAIL_ROW_CLASS} w-full ${
                  active ? "bg-primary-tint text-primary" : RAIL_ROW_IDLE
                }`}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * **The rail, before the editor arrives** — for a long editor's `loading.tsx`
 * (docs/design/pixel-craft.md, class 11: a skeleton has the loaded page's
 * geometry). The same box as `EditorRail`, one 44px stub per section in place
 * of each link; like the rail, nothing below `lg`.
 */
export function EditorRailSkeleton({ count }: { count: number }) {
  return (
    <div className={RAIL_CLASS}>
      <div className={RAIL_LIST_CLASS}>
        {Array.from({ length: count }, (_, entry) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed run of placeholders, never reordered.
            key={entry}
            className="h-11 w-full rounded-lg bg-surface-sunken"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * **What is unsaved, and where** — the sentence beside the one Save.
 *
 * A long editor has exactly one Save (`StickyFormActions`), which is honest
 * about the transaction and silent about the distance: a writer who fixed the
 * subhead at the top and then scrolled two thousand pixels has no way to tell
 * whether the button under their thumb still owes anything to the section they
 * left. This says so, by name.
 *
 * **Dirtiness is read off the DOM, not off a registry.** Every section element
 * wraps its own fields, so the map from a control to its section *is*
 * containment — nothing to register, nothing to keep in step when a field
 * moves. A section that has been edited stays named until the save navigates
 * away: this watches `input`/`change`, which cannot tell a value that was typed
 * back to what it was from one that was not, and claiming otherwise would be
 * the worse error on a form whose Save is the only way to find out.
 *
 * Mount it inside the form, beside the submit control.
 */
export function UnsavedSections({
  sections,
  copy,
}: {
  sections: readonly EditorSectionRef[];
  copy: EditorUnsavedCopy;
}) {
  const dirty = useDirtySections(sections);
  const sentence =
    dirty.length === 0
      ? null
      : dirty.length === 1
        ? (copy.inSection[sections.findIndex((section) => section.id === dirty[0])] ?? null)
        : (copy.inSections[dirty.length] ?? null);
  // Always in the document, never conditionally mounted: a live region has to
  // exist before its content changes or the change is never announced.
  //
  // **Out of the row's flow while it is silent.** It sits in
  // `StickyFormActions`, a `gap-3` flex row, where an empty span is still a
  // flex item: the pixel probe found it taking 12px after the Save on every
  // dive-site editor capture. `absolute` takes a box out of flex layout
  // without taking it out of the accessibility tree (`hidden` would do both,
  // and a region that appears with its words is one nobody hears), and an
  // empty span positioned there is 0 by 0.
  return (
    <span aria-live="polite" className={`text-sm text-muted${sentence ? "" : " absolute"}`}>
      {sentence}
    </span>
  );
}

/**
 * The section the reader is looking at, for the rail's one tinted entry.
 *
 * A band across the top of the viewport rather than a scroll position: the
 * sections are wildly uneven (a two-field group above a map editor), so "the
 * first section still showing near the top" tracks reading far better than any
 * proportion of the document. When nothing is in the band — mid-scroll through
 * one very tall section — the last answer stands rather than blanking.
 */
function useCurrentSection(sections: readonly EditorSectionRef[]): string | null {
  const idKey = sectionIdKey(sections);
  const [current, setCurrent] = useState<string | null>(sections[0]?.id ?? null);

  useEffect(() => {
    const ids = idKey.split(" ").filter(Boolean);
    setCurrent((previous) => (previous && ids.includes(previous) ? previous : (ids[0] ?? null)));
    if (typeof IntersectionObserver === "undefined") return;
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;
    const showing = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) showing.add(entry.target.id);
          else showing.delete(entry.target.id);
        }
        const first = ids.find((id) => showing.has(id));
        if (first) setCurrent(first);
      },
      // Top edge pulled below the chrome, bottom edge well up the viewport:
      // what is left is a reading band a few hundred pixels tall.
      { rootMargin: "-12% 0px -68% 0px" },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [idKey]);

  return current;
}

/**
 * Which sections hold edits nobody has saved, in the rail's own order.
 *
 * **At the document, in the capture phase**, and that is not incidental: the
 * two richest controls on the course editor — `DayByDayEditor` and `FaqEditor`
 * — are controlled React components whose own handlers may stop propagation, so
 * a listener on the `<form>` in the bubble phase never hears them type. Capture
 * runs before any of that, and the document is the one node guaranteed to be
 * above every section whether this hook is mounted inside the form or beside
 * the Save button under it.
 *
 * A section is dirty once and stays dirty. The question a writer standing over
 * Save is asking is "what have I touched since this loaded", and typing a
 * character back out again is not an undo.
 */
export function useDirtySections(sections: readonly { id: string }[]): readonly string[] {
  const idKey = sectionIdKey(sections);
  const [dirty, setDirty] = useState<readonly string[]>([]);

  useEffect(() => {
    const ids = idKey.split(" ").filter(Boolean);
    if (ids.length === 0) return;
    // `getElementById` plus a containment check rather than a selector built
    // from the id: a section id is ours, but building a selector out of one is
    // how an id that is merely unusual becomes a thrown `SyntaxError` at the
    // top of an effect.
    const found = ids
      .map((id) => ({ id, element: document.getElementById(id) }))
      .filter((entry): entry is { id: string; element: HTMLElement } => entry.element !== null);
    if (found.length === 0) return;
    const edited = new Set<string>();
    const onEdit = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const hit = found.find((entry) => entry.element.contains(target));
      if (!hit || edited.has(hit.id)) return;
      edited.add(hit.id);
      setDirty(ids.filter((id) => edited.has(id)));
    };
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, [idKey]);

  return dirty;
}

/**
 * The section ids as one string, so an effect can be keyed on *which* sections
 * there are rather than on the fresh array a caller builds each render — which
 * would tear the observer and both listeners down on every keystroke.
 */
function sectionIdKey(sections: readonly { id: string }[]): string {
  return sections.map((section) => section.id).join(" ");
}
