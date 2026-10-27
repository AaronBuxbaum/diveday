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

  useEffect(() => {
    const sync = () => {
      const fragment = window.location.hash.slice(1);
      if (fragments.includes(fragment)) setSelected(fragment);
      else if (groupIds.includes(fragment)) setSelected(`group:${fragment}`);
      else setSelected(settingsSectionFragment(initialSection ?? "timezone"));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
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
    <div data-settings-selection={selected ?? undefined} className="space-y-10">
      <style>{styles}</style>
      {children}
    </div>
  );
}
