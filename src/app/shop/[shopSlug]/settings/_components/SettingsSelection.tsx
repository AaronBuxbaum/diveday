"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  SECTION_IDS,
  SETTINGS_GROUPS,
  type SectionId,
  settingsSectionFragment,
} from "../settings-groups";

const fragments = SECTION_IDS.map(settingsSectionFragment);
const groupIds: string[] = SETTINGS_GROUPS.map((group) => group.id);
export const SETTINGS_SELECTION_EVENT = "settings-selection-change";
const styles =
  fragments
    .map(
      (fragment) => `
      [data-settings-selection="${fragment}"] [data-settings-group]:not(:has([data-settings-section="${fragment}"])):not(:has([data-settings-urgent])) { display: none; }
      [data-settings-selection="${fragment}"] [data-settings-section]:not([data-settings-section="${fragment}"]),
      [data-settings-selection="${fragment}"] [data-settings-door] { display: none; }
    `,
    )
    .join("\n") +
  groupIds
    .map(
      (group) => `
    [data-settings-selection="group:${group}"] [data-settings-group]:not([data-settings-group="${group}"]):not(:has([data-settings-urgent])) { display: none; }
  `,
    )
    .join("\n");

/** The rail chooses one inline editor; pending data jobs remain visible. */
export function SettingsSelection({
  initialSection,
  children,
}: {
  initialSection: SectionId | null;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [selectionPending, setSelectionPending] = useState(false);

  useEffect(() => {
    let pendingFrame: number | null = null;
    let pendingSelection: string | null = null;
    let listeningForRelease = false;
    const cancelPendingFrame = () => {
      if (pendingFrame === null) return;
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    };
    const removeReleaseListeners = () => {
      if (!listeningForRelease) return;
      document.removeEventListener("pointerup", applyAfterRelease, true);
      document.removeEventListener("pointercancel", applyAfterRelease, true);
      listeningForRelease = false;
    };
    const applyAfterRelease = () => {
      cancelPendingFrame();
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = null;
        // A second pointer may still be holding a control. Wait for its release
        // event instead of spinning animation frames while the press is active.
        if (document.querySelector("[data-settings-group] :active")) return;
        const selection = pendingSelection;
        pendingSelection = null;
        removeReleaseListeners();
        setSelectionPending(false);
        if (selection !== null) setSelected(selection);
      });
    };
    const sync = () => {
      cancelPendingFrame();
      const fragment = window.location.hash.slice(1);
      const nextSelection = fragments.includes(fragment)
        ? fragment
        : groupIds.includes(fragment)
          ? `group:${fragment}`
          : settingsSectionFragment(initialSection ?? "timezone");
      const pressedControl = document.querySelector<HTMLElement>("[data-settings-group] :active");

      if (!pressedControl) {
        pendingSelection = null;
        removeReleaseListeners();
        setSelectionPending(false);
        setSelected(nextSelection);
        return;
      }

      // A fragment can arrive while the reader is pressing a door or row in
      // the server-rendered all-groups view. Applying the selection immediately
      // can move that active target before pointerup, canceling its click.
      // Keep the server view until the press ends, then reconcile the hash.
      pendingSelection = nextSelection;
      setSelectionPending(true);
      if (listeningForRelease) return;
      document.addEventListener("pointerup", applyAfterRelease, true);
      document.addEventListener("pointercancel", applyAfterRelease, true);
      listeningForRelease = true;
    };
    setHydrated(true);
    sync();
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      cancelPendingFrame();
      removeReleaseListeners();
    };
  }, [initialSection]);

  useEffect(() => {
    if (!selected) return;
    window.dispatchEvent(new CustomEvent(SETTINGS_SELECTION_EVENT, { detail: selected }));
    const row = document.querySelector<HTMLDetailsElement>(
      `[data-settings-selection] [data-settings-section="${selected}"] details`,
    );
    if (row) row.open = true;
  }, [selected]);

  return (
    <div
      data-hydrated={hydrated ? "true" : undefined}
      data-selection-pending={selectionPending ? "true" : undefined}
      data-settings-selection-root
      data-settings-selection={selected ?? undefined}
      className="space-y-10"
    >
      <style>{styles}</style>
      {children}
    </div>
  );
}
