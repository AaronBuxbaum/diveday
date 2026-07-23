"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keyboard shortcuts beyond ⌘K, made discoverable. A "g then key" sequence jumps
 * to the shop's main surfaces (Gmail-style), and `?` opens a cheat-sheet that
 * lists every shortcut — so the feature announces itself instead of hiding.
 * Shortcuts never fire while typing in a field, and modifier combos are left to
 * the browser and the command palette (which owns ⌘K).
 */

type NavShortcut = { key: string; label: string; suffix: string };

const NAV_SHORTCUTS: NavShortcut[] = [
  { key: "t", label: "Today", suffix: "" },
  { key: "s", label: "Schedule", suffix: "/schedule" },
  { key: "d", label: "Divers", suffix: "/divers" },
  { key: "b", label: "Blockers", suffix: "/blockers" },
  { key: "w", label: "Waivers", suffix: "/waivers" },
];

/** True when focus is in a text-entry surface, where letter keys are content. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true
  );
}

export function KeyboardShortcuts({ shopSlug }: { shopSlug: string }) {
  const router = useRouter();
  const root = `/shop/${shopSlug}`;
  const [helpOpen, setHelpOpen] = useState(false);
  // Timestamp of a pending "g", so the next key completes the sequence.
  const pendingG = useRef<number | null>(null);

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
        const target = NAV_SHORTCUTS.find((shortcut) => shortcut.key === event.key.toLowerCase());
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
  }, [router, root]);

  const close = useCallback(() => setHelpOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        aria-keyshortcuts="?"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (press ?)"
        className="hidden size-9 shrink-0 items-center justify-center rounded-xl border border-border text-sm font-semibold text-muted transition-colors hover:bg-surface-sunken hover:text-foreground sm:inline-flex"
      >
        <kbd className="font-semibold">?</kbd>
      </button>

      {helpOpen ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: presentational backdrop
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/30 px-4 pt-[12vh] backdrop-blur-sm"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-sunken hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <dl className="divide-y divide-border">
              <ShortcutRow keys={["⌘", "K"]} label="Search divers, trips, and pages" />
              <ShortcutRow keys={["?"]} label="Show this help" />
              {NAV_SHORTCUTS.map((shortcut) => (
                <ShortcutRow
                  key={shortcut.key}
                  keys={["G", shortcut.key.toUpperCase()]}
                  label={`Go to ${shortcut.label}`}
                />
              ))}
            </dl>
            <p className="border-t border-border px-5 py-3 text-xs text-muted">
              Press keys one after another for a sequence — e.g. <kbd>G</kbd> then <kbd>S</kbd> for
              the schedule.
            </p>
          </div>
        </div>
      ) : null}
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
