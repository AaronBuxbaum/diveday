"use client";

import { useId, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import {
  RepeatingItemCard,
  repeatingItemAddClass,
  repeatingItemRemoveClass,
} from "@/components/editor/RepeatingItemCard";
import { ImageFileInput, type ImageFileInputCopy } from "@/components/ImageFileInput";
import { StoredPhoto } from "@/components/StoredPhoto";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, textareaClassFor } from "@/components/ui/form";
import {
  DIVE_SITE_LANDMARK_KINDS,
  type DiveSiteLandmark,
  type DiveSiteLandmarkKind,
  landmarkPhotoField,
  MAX_SITE_LANDMARKS,
} from "@/lib/dive-site-landmarks";

export type LandmarkEditorCopy = {
  nameLabel: string;
  namePlaceholder: string;
  kindLabel: string;
  /** One label per kind code, resolved server-side (this is a Client Component). */
  kindLabels: Record<DiveSiteLandmarkKind, string>;
  noteLabel: string;
  notePlaceholder: string;
  photoLabel: string;
  removePhoto: string;
  imageInput: ImageFileInputCopy;
  add: string;
  remove: string;
  /**
   * The remove button's accessible name, carrying a literal `{name}` for this
   * row's landmark. A *template* rather than a resolved string or a function:
   * the name is client state (it is being typed), and a Server Component may
   * not hand a function to a Client one — Next refuses the whole render. One
   * token substituted below; the sentence itself still comes from the bundle.
   */
  removeAriaLabel: string;
  empty: string;
  full: string;
};

/**
 * Shop-authored landmark notes post as JSON and are normalized by
 * `parseDiveSiteLandmarks`; refused submits restore the submitted list.
 */
export function LandmarkEditor({
  initialLandmarks,
  copy,
}: {
  initialLandmarks: DiveSiteLandmark[];
  copy: LandmarkEditorCopy;
}) {
  const [landmarks, setLandmarks] = useState<DiveSiteLandmark[]>(initialLandmarks);
  // Keys stay with rows so removing an earlier row keeps a picked file with
  // its input; posted input names still follow the server's row index.
  const nextKey = useRef(initialLandmarks.length);
  const [keys, setKeys] = useState<number[]>(() => initialLandmarks.map((_, index) => index));
  const idPrefix = useId();
  const full = landmarks.length >= MAX_SITE_LANDMARKS;

  const update = (index: number, patch: Partial<DiveSiteLandmark>) =>
    setLandmarks((current) =>
      current.map((landmark, at) => (at === index ? { ...landmark, ...patch } : landmark)),
    );
  const removeRow = (index: number) => {
    setLandmarks((current) => current.filter((_, at) => at !== index));
    setKeys((current) => current.filter((_, at) => at !== index));
  };

  return (
    // The form's "Landmarks" section supplies the legend (ADR 20260827-the-shops-shelves).
    <div>
      {/* The record the form posts. Always present, even when empty: clearing
          the last landmark has to be savable too. */}
      <input type="hidden" name="landmarks" value={JSON.stringify(landmarks)} />

      {landmarks.length === 0 ? (
        // Nested inside a section, so no icon — same shared panel the field
        // guide and the route editor wear for the same state.
        <EmptyState title={copy.empty} icon={false} />
      ) : (
        <ul className="space-y-3">
          {landmarks.map((landmark, index) => (
            <RepeatingItemCard
              as="li"
              key={keys[index]}
              remove={
                <button
                  type="button"
                  aria-label={copy.removeAriaLabel.replace("{name}", landmark.name)}
                  onClick={() => removeRow(index)}
                  className={repeatingItemRemoveClass}
                >
                  {copy.remove}
                </button>
              }
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
                <Field label={copy.nameLabel} className="flex-1 sm:min-w-48">
                  <input
                    value={landmark.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    maxLength={80}
                    placeholder={copy.namePlaceholder}
                    className={controlClass}
                  />
                </Field>
                <Field label={copy.kindLabel} className="w-full sm:w-auto sm:min-w-40">
                  <select
                    value={landmark.kind}
                    onChange={(event) =>
                      update(index, { kind: event.target.value as DiveSiteLandmarkKind })
                    }
                    className={controlClass}
                  >
                    {DIVE_SITE_LANDMARK_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {copy.kindLabels[kind]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={copy.noteLabel} className="mt-4">
                <textarea
                  value={landmark.note}
                  onChange={(event) => update(index, { note: event.target.value })}
                  rows={2}
                  maxLength={400}
                  placeholder={copy.notePlaceholder}
                  className={textareaClassFor(2)}
                />
              </Field>
              <Field
                label={copy.photoLabel}
                className="mt-4"
                group={Boolean(landmark.photoUrl)}
                htmlFor={landmark.photoUrl ? undefined : `${idPrefix}-photo-${keys[index]}`}
              >
                {landmark.photoUrl ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <StoredPhoto
                      src={landmark.photoUrl}
                      alt=""
                      className="h-24 w-36 rounded-inset border border-border"
                      sizes="144px"
                    />
                    <button
                      type="button"
                      onClick={() => update(index, { photoUrl: undefined })}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {copy.removePhoto}
                    </button>
                  </div>
                ) : (
                  <div className="w-36">
                    <ImageFileInput
                      id={`${idPrefix}-photo-${keys[index]}`}
                      name={landmarkPhotoField(index)}
                      copy={copy.imageInput}
                    />
                  </div>
                )}
              </Field>
            </RepeatingItemCard>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          disabled={full}
          onClick={() => {
            setLandmarks((current) => [
              ...current,
              { name: "", kind: "pointOfInterest", note: "" },
            ]);
            setKeys((current) => [...current, nextKey.current++]);
          }}
          className={repeatingItemAddClass}
        >
          {copy.add}
        </button>
        {full ? <p className="text-sm text-muted">{copy.full}</p> : null}
      </div>
    </div>
  );
}
