"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useDirtySections } from "@/components/editor/EditorRail";

/** One control's state as the writer left it, addressed by name and position. */
type Typed = { name: string; index: number; value: string; checked: boolean };

/**
 * Never carried in a draft: it is this render's optimistic-concurrency token,
 * and restoring a stale one would aim the save at a generation of the row that
 * somebody else has since replaced (`ConflictGuardedForm`, issue #820). The
 * live server-rendered value stays, so a restored draft still saves against
 * whatever the row is *now* — and is refused, visibly, if it has moved.
 */
const NEVER_RESTORED = new Set(["expectedVersion"]);

/** Every named control in a form, in document order, with what it holds. */
function snapshot(form: HTMLFormElement): Typed[] {
  const seen = new Map<string, number>();
  const out: Typed[] = [];
  for (const element of Array.from(form.elements)) {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (!field.name || NEVER_RESTORED.has(field.name)) continue;
    // A file input's value cannot be assigned, so restoring one is impossible
    // rather than merely awkward — the writer re-picks the photo.
    if (field instanceof HTMLInputElement && field.type === "file") continue;
    const index = seen.get(field.name) ?? 0;
    seen.set(field.name, index + 1);
    out.push({
      name: field.name,
      index,
      value: field.value,
      checked: field instanceof HTMLInputElement ? field.checked : false,
    });
  }
  return out;
}

/** Write a snapshot back into the form it came from. Returns what it changed. */
function restore(form: HTMLFormElement, saved: Typed[]): number {
  const seen = new Map<string, number>();
  let changed = 0;
  for (const element of Array.from(form.elements)) {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (!field.name || NEVER_RESTORED.has(field.name)) continue;
    if (field instanceof HTMLInputElement && field.type === "file") continue;
    const index = seen.get(field.name) ?? 0;
    seen.set(field.name, index + 1);
    const was = saved.find((item) => item.name === field.name && item.index === index);
    if (!was) continue;
    if (
      field instanceof HTMLInputElement &&
      (field.type === "checkbox" || field.type === "radio")
    ) {
      if (field.checked === was.checked) continue;
      field.checked = was.checked;
    } else {
      if (field.value === was.value) continue;
      field.value = was.value;
    }
    changed += 1;
    // React owns some of these boxes (the day-by-day plan and the FAQ are
    // controlled), so an assignment alone leaves its state behind the DOM.
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return changed;
}

/**
 * One field's value out of a stored draft, for an editor that cannot be
 * restored by assignment.
 *
 * `restore()` above writes straight into the DOM, which works for every plain
 * box on this form. It cannot work for `DayByDayEditor` or `FaqEditor`: those
 * hold their rows in React state and post one hidden JSON field, so setting
 * that field's `value` changes nothing a writer can see and is overwritten on
 * the next render. So each of them seeds itself from the draft instead — the
 * state is theirs, and so is putting it back.
 *
 * Returns null for anything unreadable, and never throws: a draft is a
 * courtesy and must not be able to break the editor it protects.
 */
export function draftFieldValue(storageKey: string, name: string): string | null {
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (!stored) return null;
    const saved = JSON.parse(stored) as Typed[];
    if (!Array.isArray(saved)) return null;
    return saved.find((field) => field.name === name && field.index === 0)?.value ?? null;
  } catch {
    return null;
  }
}

const DirtyContext = createContext<{ dirty: boolean; restored: boolean }>({
  dirty: false,
  restored: false,
});

/** How long after the last keystroke the draft is written. */
const SAVE_DELAY_MS = 500;

/**
 * **Keeps the writer's unsaved work, and says when it has.**
 *
 * The course editor is one long page with no autosave. It used to guard only
 * a real browser unload with `beforeunload`, and its own comment noted that a
 * same-app `<Link>` never fires that event — which read like an open hole and
 * was reported as one (issue #815): tap Today, lose an afternoon.
 *
 * **Measured, that is not what happens.** Under Cache Components, Next hides a
 * navigated-away page with React's `<Activity>` rather than unmounting it, so
 * the DOM — and every word typed into it — is still there when you come back,
 * by Back *or* by clicking your way in again. What is true is narrower and
 * nastier: Activity keeps **three** routes, so the loss depends on how many
 * places you visited in between. Four hops away and the draft is gone, with no
 * prompt and nothing to distinguish that trip from the one before it.
 *
 * Which is why this does not prompt on navigation. A confirm dialog would fire
 * on every nav tap, and would be a false alarm in exactly the common case
 * where nothing is lost. Instead the draft is written to `sessionStorage` and
 * put back on mount:
 *
 * - **`sessionStorage`, not `localStorage`.** It dies with the tab, so a
 *   half-written course page cannot surface tomorrow on a shared front-desk
 *   machine.
 * - **Restoring is announced**, through `UnsavedChangesNote` — a form that
 *   quietly differs from the row it claims to be editing is worse than one
 *   that lost the edit, because the writer has no reason to look.
 * - **`beforeunload` stays.** A closed tab takes `sessionStorage` with it, so
 *   that is still the one exit where the warning is the only protection.
 */
export function UnsavedChangesGuard({
  storageKey,
  children,
}: {
  /** Scopes the draft to one row — a second course's draft must not land here. */
  storageKey: string;
  children: React.ReactNode;
}) {
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  // The e2e suite waits on this before it types: the dirty flag is React's
  // `onInputCapture`, so a keystroke that lands before hydration is a native
  // event nobody is listening to — the box holds the text and the bar never
  // says so. The same signal the orders and counter search boxes carry.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const wrapper = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      // Chrome only shows its native prompt when returnValue is set.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  // Put a draft back, once, after hydration — before that the boxes hold the
  // server's values and React has not attached to them yet.
  useEffect(() => {
    const form = wrapper.current?.querySelector("form");
    if (!form) return;
    formEl.current = form;
    let saved: Typed[];
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (!stored) return;
      saved = JSON.parse(stored) as Typed[];
      if (!Array.isArray(saved)) return;
    } catch {
      // Unparseable, or storage unavailable (private mode, quota). A draft is
      // a courtesy; never let one break the editor it is protecting.
      return;
    }
    if (restore(form, saved) > 0) {
      setDirty(true);
      setRestored(true);
    }
  }, [storageKey]);

  // The form element itself, held from the first keystroke. `wrapper.current`
  // is already detached by the time an unmount cleanup runs, and the flush
  // below happens in exactly that cleanup.
  const formEl = useRef<HTMLFormElement | null>(null);
  const save = useRef(() => {});
  save.current = () => {
    const form = formEl.current;
    if (!form) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot(form)));
    } catch {
      // Out of quota, or storage refused. The in-tab protections above still
      // hold; there is nothing useful to tell the writer here.
    }
  };

  function scheduleSave() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      save.current();
    }, SAVE_DELAY_MS);
  }

  // **Flush on the way out, never cancel.** React runs an effect's cleanup when
  // Activity *hides* a page, not only when it unmounts one — so a writer who
  // types and taps a nav tab inside the debounce window used to lose exactly
  // the keystrokes the draft existed to keep. Measured: it dropped the whole
  // edit, every time, when the tap came under half a second after the typing.
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      save.current();
    },
    [],
  );

  return (
    <DirtyContext.Provider value={{ dirty, restored }}>
      <div
        ref={wrapper}
        data-hydrated={hydrated ? "true" : undefined}
        onInputCapture={(event) => {
          formEl.current = (event.target as HTMLElement).closest("form");
          setDirty(true);
          scheduleSave();
        }}
        onChangeCapture={(event) => {
          formEl.current = (event.target as HTMLElement).closest("form");
          setDirty(true);
          scheduleSave();
        }}
        onSubmit={() => {
          if (timer.current) clearTimeout(timer.current);
          setDirty(false);
          setRestored(false);
          try {
            window.sessionStorage.removeItem(storageKey);
          } catch {
            // See above.
          }
        }}
      >
        {children}
      </div>
    </DirtyContext.Provider>
  );
}

/**
 * The two states of this form a screenshot cannot show: that it holds edits
 * nobody has saved, and that those edits were put back rather than read from
 * the row. Both are consequences the writer would otherwise have to infer.
 * Renders nothing when the form is clean.
 *
 * Since ADR 20260827-the-shops-shelves put this editor on a section rail, the
 * unsaved half also **names the section**. On a form this tall, "Unsaved
 * changes" told a writer standing over the Save button nothing they could act
 * on — the section they changed was four screens away, and the rail is right
 * there to take them back to it. Which sections are dirty comes from
 * `useDirtySections`, by containment in the DOM (see `EditorRail.tsx`, whose
 * listeners sit on the document in the capture phase precisely so the two
 * controlled editors below can stop propagation without going unnoticed); the
 * sentences are built on the server, because staff copy never crosses to the
 * client as a bundle.
 */
export function UnsavedChangesNote({
  unsavedLabel,
  restoredLabel,
  sections,
  countSentences,
}: {
  /** The fallback: dirty, but nothing that traces to a section. */
  unsavedLabel: string;
  restoredLabel: string;
  /** Every section of the form, each with the sentence naming it as the dirty one. */
  sections: readonly { id: string; unsavedSentence: string }[];
  /** `countSentences[n - 1]` is the sentence for `n` dirty sections. */
  countSentences: readonly string[];
}) {
  const { dirty, restored } = useContext(DirtyContext);
  // Called above the early return, and from a component that is mounted from
  // the first paint: the listener has to be attached before the keystroke that
  // flips `dirty`, not one render after it.
  const dirtySections = useDirtySections(sections);
  if (!dirty) return null;
  const named =
    dirtySections.length === 1
      ? sections.find((section) => section.id === dirtySections[0])?.unsavedSentence
      : dirtySections.length > 1
        ? countSentences[dirtySections.length - 1]
        : undefined;
  return (
    <p className="text-sm font-medium text-muted" aria-live="polite">
      {restored ? restoredLabel : (named ?? unsavedLabel)}
    </p>
  );
}
