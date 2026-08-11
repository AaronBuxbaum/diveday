"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/components/useFocusTrap";

/**
 * Keyboard shortcuts beyond ⌘K, made discoverable. A "g then key" sequence jumps
 * to the shop's main surfaces (Gmail-style), and `?` opens a cheat-sheet that
 * lists every shortcut — so the feature announces itself instead of hiding.
 * Shortcuts never fire while typing in a field, and modifier combos are left to
 * the browser and the command palette (which owns ⌘K).
 */

type NavShortcut = { key: string; goToLabel: string; suffix: string };

/** Every word this component renders, resolved server-side. */
export interface KeyboardShortcutsCopy {
  buttonAriaLabel: string;
  buttonTitle: string;
  dialogAriaLabel: string;
  closeAriaLabel: string;
  heading: string;
  paletteLabel: string;
  helpLabel: string;
  sequenceHint: ReactNode;
  /** Already filtered for the viewer's permissions — e.g. no `w` entry when they can't manage waivers. */
  navShortcuts: NavShortcut[];
}

/** True when focus is in a text-entry surface, where letter keys are content. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true
  );
}

export function KeyboardShortcuts({
  shopSlug,
  copy,
}: {
  shopSlug: string;
  copy: KeyboardShortcutsCopy;
}) {
  const router = useRouter();
  const root = `/shop/${shopSlug}`;
  const [helpOpen, setHelpOpen] = useState(false);
  // Timestamp of a pending "g", so the next key completes the sequence.
  const pendingG = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const navShortcuts = copy.navShortcuts;

  useFocusTrap(helpOpen, dialogRef);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Leave modifier combos (⌘K, browser shortcuts) and in-field typing alone.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "Escape") {
        pendingG.current = null;
        setHelpOpen(false);
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        pendingG.current = null;
        setHelpOpen((open) => !open);
        return;
      }

      const now = event.timeStamp;
      if (pendingG.current !== null && now - pendingG.current < 1500) {
        pendingG.current = null;
        const target = navShortcuts.find((shortcut) => shortcut.key === event.key.toLowerCase());
        if (target) {
          event.preventDefault();
          setHelpOpen(false);
          router.push(`${root}${target.suffix}`);
        }
        return;
      }
      if (event.key.toLowerCase() === "g") {
        pendingG.current = now;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, root, navShortcuts]);

  const close = useCallback(() => setHelpOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        aria-keyshortcuts="?"
        aria-label={copy.buttonAriaLabel}
        title={copy.buttonTitle}
        // `size-11`, not `size-9`: this sits immediately beside the command
        // palette's Search button, which is `min-h-11`, and two bordered boxes
        // on one row at 36px and 44px read as a misalignment rather than as
        // two controls — the shorter box's edges line up with nothing. Square
        // at the taller box's own height, and it clears the 44px tap target
        // the rest of the app holds to as a bonus.
        className="hidden size-11 shrink-0 items-center justify-center rounded-xl border border-border text-sm font-semibold text-muted transition-colors hover:bg-surface-sunken hover:text-foreground sm:inline-flex"
      >
        <kbd className="font-semibold">?</kbd>
      </button>

      {helpOpen
        ? createPortal(
            // The header this button lives in has `backdrop-blur`, which makes it a
            // containing block for `position: fixed` descendants — a portal escapes
            // that so the backdrop covers the full viewport instead of just the
            // header's own box.
            // biome-ignore lint/a11y/noStaticElementInteractions: presentational backdrop
            <div
              className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/30 px-4 pt-[12vh] backdrop-blur-sm"
              role="presentation"
              onClick={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={copy.dialogAriaLabel}
                tabIndex={-1}
                className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl outline-none"
              >
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <h2 className="text-base font-semibold">{copy.heading}</h2>
                  <button
                    type="button"
                    onClick={close}
                    aria-label={copy.closeAriaLabel}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-sunken hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
                <dl className="divide-y divide-border">
                  <ShortcutRow keys={["⌘", "K"]} label={copy.paletteLabel} />
                  <ShortcutRow keys={["?"]} label={copy.helpLabel} />
                  {navShortcuts.map((shortcut) => (
                    <ShortcutRow
                      key={shortcut.key}
                      keys={["G", shortcut.key.toUpperCase()]}
                      label={shortcut.goToLabel}
                    />
                  ))}
                </dl>
                <p className="border-t border-border px-5 py-3 text-xs text-muted">
                  {copy.sequenceHint}
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <dt className="text-sm">{label}</dt>
      <dd className="flex shrink-0 items-center gap-1">
        {keys.map((key, index) => (
          <kbd
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed static key list
            key={index}
            className="min-w-6 rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-center text-xs font-semibold text-muted"
          >
            {key}
          </kbd>
        ))}
      </dd>
    </div>
  );
}
