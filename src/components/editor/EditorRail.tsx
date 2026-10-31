"use client";

import { useEffect, useState } from "react";
import type { EditorSectionRef, EditorUnsavedCopy } from "./EditorSection";

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
 * Which sections hold edits nobody has saved, in the editor's declared order.
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
 * would tear both event listeners down on every keystroke.
 */
function sectionIdKey(sections: readonly { id: string }[]): string {
  return sections.map((section) => section.id).join(" ");
}
