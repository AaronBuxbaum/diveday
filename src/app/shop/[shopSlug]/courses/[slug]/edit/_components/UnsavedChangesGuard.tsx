"use client";

import { useEffect, useRef } from "react";

/**
 * Warns before the tab closes, reloads, or the address bar navigates away
 * while this form has unsaved edits — the course editor is one long page with
 * no autosave, so a stray reload used to discard everything silently. Wrap
 * the `<form>` (or anything containing it) in this; it tracks "dirty" from
 * any `input`/`change` bubbling up from inside, and clears it again on a
 * genuine form submit so a normal save never triggers its own warning.
 *
 * This only covers a real browser unload — a same-app `<Link>` navigation in
 * the App Router does not fire `beforeunload` at all, since it never
 * unloads the page. The one link on this page that could discard an edit
 * that way (Preview) is made to open in a new tab instead, so the edit stays
 * intact in this one either way.
 */
export function UnsavedChangesGuard({ children }: { children: React.ReactNode }) {
  const dirty = useRef(false);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty.current) return;
      event.preventDefault();
      // Chrome only shows its native prompt when returnValue is set.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <div
      onInputCapture={() => {
        dirty.current = true;
      }}
      onChangeCapture={() => {
        dirty.current = true;
      }}
      onSubmit={() => {
        dirty.current = false;
      }}
    >
      {children}
    </div>
  );
}
