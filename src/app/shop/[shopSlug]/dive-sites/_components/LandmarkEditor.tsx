"use client";

import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import {
  DIVE_SITE_LANDMARK_KINDS,
  type DiveSiteLandmark,
  type DiveSiteLandmarkKind,
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
 * The landmarks a crew points at, each with the shop's own note on it.
 *
 * This replaced a one-per-line textarea whose lines were *only* names: the
 * paragraph a diver read under each one came from a table in
 * `src/lib/dive-site-landmarks.ts` keyed by site name and landmark name, so
 * seven landmarks at three DiveDay demo sites had words and every landmark any
 * real shop typed got the same generic sentence. There was no field anywhere
 * that could change that.
 *
 * Same shape as `RouteEditor` beside it: client state, one hidden input
 * carrying the whole list as JSON, and the server normalising what arrives
 * (`parseDiveSiteLandmarks`) rather than trusting it. That is what lets a
 * refused submit hand the list back exactly as it was typed — the form
 * re-renders from the server and this component's `initialLandmarks` is the
 * submitted value.
 */
export function LandmarkEditor({
  initialLandmarks,
  copy,
}: {
  initialLandmarks: DiveSiteLandmark[];
  copy: LandmarkEditorCopy;
}) {
  const [landmarks, setLandmarks] = useState<DiveSiteLandmark[]>(initialLandmarks);
  const full = landmarks.length >= MAX_SITE_LANDMARKS;

  const update = (index: number, patch: Partial<DiveSiteLandmark>) =>
    setLandmarks((current) =>
      current.map((landmark, at) => (at === index ? { ...landmark, ...patch } : landmark)),
    );

  return (
    // No box and no legend of its own: the editor is the body of the form's
    // "Landmarks" section, which carries the name and the sentence under it
    // (ADR 20260827-the-shops-shelves, the long-form editor pattern).
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
            <li
              // Landmarks have no identity beyond their position in the list,
              // and two can share a name while one is being retyped — the index
              // is the only stable key here.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={index}
              className="rounded-lg border border-border bg-surface-sunken p-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <label className="min-w-0 flex-1 text-sm font-medium sm:min-w-48">
                  {copy.nameLabel}
                  <input
                    value={landmark.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    maxLength={80}
                    placeholder={copy.namePlaceholder}
                    className={`${controlClass} mt-1`}
                  />
                </label>
                <label className="w-full text-sm font-medium sm:w-auto sm:min-w-40">
                  {copy.kindLabel}
                  <select
                    value={landmark.kind}
                    onChange={(event) =>
                      update(index, { kind: event.target.value as DiveSiteLandmarkKind })
                    }
                    className={`${controlClass} mt-1`}
                  >
                    {DIVE_SITE_LANDMARK_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {copy.kindLabels[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  aria-label={copy.removeAriaLabel.replace("{name}", landmark.name)}
                  onClick={() => setLandmarks((current) => current.filter((_, at) => at !== index))}
                  className={buttonClass({
                    variant: "ghost",
                    size: "sm",
                    className: "w-full sm:w-auto",
                  })}
                >
                  {copy.remove}
                </button>
              </div>
              <label className="mt-3 block text-sm font-medium">
                {copy.noteLabel}
                <textarea
                  value={landmark.note}
                  onChange={(event) => update(index, { note: event.target.value })}
                  rows={2}
                  maxLength={400}
                  placeholder={copy.notePlaceholder}
                  className={`${controlClass} mt-1`}
                />
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          disabled={full}
          onClick={() =>
            setLandmarks((current) => [...current, { name: "", kind: "pointOfInterest", note: "" }])
          }
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.add}
        </button>
        {full ? <p className="text-sm text-muted">{copy.full}</p> : null}
      </div>
    </div>
  );
}
