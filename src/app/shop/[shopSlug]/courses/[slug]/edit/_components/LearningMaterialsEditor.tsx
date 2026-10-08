"use client";

import { useEffect, useRef, useState } from "react";
import {
  RepeatingItemCard,
  repeatingItemAddClass,
  repeatingItemRemoveClass,
} from "@/components/editor/RepeatingItemCard";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { LEARNING_MATERIAL_LIMITS, MAX_LEARNING_MATERIALS } from "@/lib/course-limits";
import { draftFieldValue } from "./UnsavedChangesGuard";

/**
 * Plain template strings, never functions — the row count changes purely
 * client-side, the same contract as `FaqEditorCopy` next door.
 */
export interface LearningMaterialsEditorCopy {
  nameLabel: string;
  namePlaceholder: string;
  linkLabel: string;
  linkHint: string;
  noteLabel: string;
  notePlaceholder: string;
  remove: string;
  add: string;
  max: string;
  empty: string;
}

/** One row as the boxes hold it: every value a string, blank meaning absent. */
type Material = { name: string; url: string; note: string };
type Row = Material & { key: number };

const fromStored = (material: { name: string; url?: string; note?: string }): Material => ({
  name: material.name,
  url: material.url ?? "",
  note: material.note ?? "",
});

/**
 * **What a student works through before the first day**, one card per item:
 * its name, an optional link and an optional one-line note
 * (ADR 20261008-course-learning-materials).
 *
 * The FAQ editor's shape exactly: state lives here and serializes to one
 * hidden JSON field on every change, the server validates it
 * (`sanitizeLearningMaterials`, src/lib/courses.ts), and rows carry a key of
 * their own so removing the first does not move the cursor out of the second.
 * The link box is `type="url"`, so a phone offers the right keyboard; the
 * server is still what refuses anything that is not `https:`.
 */
export function LearningMaterialsEditor({
  initialMaterials,
  storageKey,
  copy,
}: {
  initialMaterials: { name: string; url?: string; note?: string }[];
  /** The unsaved-work draft these rows are part of; see `draftFieldValue`. */
  storageKey: string;
  copy: LearningMaterialsEditorCopy;
}) {
  const [nextKey, setNextKey] = useState(initialMaterials.length);
  const [rows, setRows] = useState<Row[]>(() =>
    initialMaterials.map((material, index) => ({ ...fromStored(material), key: index })),
  );
  const hidden = useRef<HTMLInputElement>(null);
  const atMax = rows.length >= MAX_LEARNING_MATERIALS;

  // A return to unsaved work restores the rows as the writer left them, in an
  // effect so the server and the first client render agree (see FaqEditor).
  useEffect(() => {
    const draft = draftFieldValue(storageKey, "learningMaterialsJson");
    if (!draft) return;
    let saved: Material[];
    try {
      saved = JSON.parse(draft) as Material[];
      if (!Array.isArray(saved)) return;
    } catch {
      return;
    }
    if (draft === JSON.stringify(initialMaterials.map(fromStored))) return;
    setRows(saved.map((material, index) => ({ ...fromStored(material), key: index })));
    setNextKey(saved.length);
    hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [storageKey, initialMaterials]);

  function update(key: number, patch: Partial<Material>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? <p className="text-sm text-muted">{copy.empty}</p> : null}
      {rows.map((row, index) => (
        <RepeatingItemCard
          key={row.key}
          remove={
            <button
              type="button"
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
              className={repeatingItemRemoveClass}
            >
              {fill(copy.remove, { number: index + 1 })}
            </button>
          }
        >
          <FieldGrid columns={1}>
            <Field label={fill(copy.nameLabel, { number: index + 1 })}>
              <input
                type="text"
                maxLength={LEARNING_MATERIAL_LIMITS.name}
                value={row.name}
                placeholder={copy.namePlaceholder}
                onChange={(event) => update(row.key, { name: event.target.value })}
                className={controlClass}
              />
            </Field>
            <Field label={copy.linkLabel} description={copy.linkHint}>
              <input
                type="url"
                inputMode="url"
                maxLength={LEARNING_MATERIAL_LIMITS.url}
                value={row.url}
                onChange={(event) => update(row.key, { url: event.target.value })}
                className={controlClass}
              />
            </Field>
            <Field label={copy.noteLabel}>
              <input
                type="text"
                maxLength={LEARNING_MATERIAL_LIMITS.note}
                value={row.note}
                placeholder={copy.notePlaceholder}
                onChange={(event) => update(row.key, { note: event.target.value })}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </RepeatingItemCard>
      ))}
      {atMax ? (
        <p className="text-sm text-muted">{copy.max}</p>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              setRows((current) => [...current, { name: "", url: "", note: "", key: nextKey }]);
              setNextKey((key) => key + 1);
            }}
            className={repeatingItemAddClass}
          >
            {copy.add}
          </button>
        </div>
      )}
      <input
        ref={hidden}
        type="hidden"
        name="learningMaterialsJson"
        value={JSON.stringify(rows.map(({ name, url, note }) => ({ name, url, note })))}
      />
    </div>
  );
}
