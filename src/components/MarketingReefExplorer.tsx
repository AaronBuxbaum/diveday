"use client";

import { useId, useSyncExternalStore } from "react";
import { MarketingReefScene } from "@/components/MarketingReefScene";
import { buttonClass } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/StatusMark";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";

const SPECIES = [0, 1, 2] as const;
export type SightedSpecies = (typeof SPECIES)[number];
type SpeciesLabels = { name: string; detail: string; inspect: string };

export type ReefLabels = {
  arrival: string;
  underwater: string;
  scene: string;
  explore: string;
  surface: string;
  title: string;
  purpose: string;
  identify: string;
  log: string;
  logged: string;
  remove: string;
  none: string;
  counts: [string, string, string, string];
  species: [SpeciesLabels, SpeciesLabels, SpeciesLabels];
};

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function listenToMotion(update: () => void) {
  const media = window.matchMedia(REDUCED_MOTION);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}

export function MarketingReefExplorer({
  labels,
  selected,
  onSelect,
  sightings,
  onUpdate,
  onSurface,
  paused,
  togglePause,
  pauseLabel,
}: {
  labels: ReefLabels;
  selected: SightedSpecies | null;
  onSelect: (index: SightedSpecies) => void;
  sightings: SightedSpecies[];
  onUpdate: (index: SightedSpecies, logged: boolean) => void;
  onSurface: () => void;
  paused: boolean;
  togglePause: () => void;
  pauseLabel: string;
}) {
  const reduced = useSyncExternalStore(
    listenToMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );
  const speciesId = useId();
  const loggedDescriptionId = useId();
  const animal = selected === null ? null : labels.species[selected];
  const logged = selected !== null && sightings.includes(selected);

  return (
    <>
      <div data-boat-phase="explore" className="relative">
        <MarketingReefScene
          names={[labels.species[0].name, labels.species[1].name, labels.species[2].name]}
          selected={selected}
          onSelect={onSelect}
          paused={paused || reduced}
          sceneLabel={labels.scene}
        />
        {!reduced ? (
          <button
            type="button"
            data-try-tap=""
            onClick={togglePause}
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "absolute end-2 bottom-2 sm:end-3 sm:bottom-3",
            })}
          >
            {pauseLabel}
          </button>
        ) : null}
      </div>
      <figcaption className="px-4 py-4 sm:px-5">
        <div className="flex min-h-7 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className={ITEM_TITLE_CLASS}>{labels.title}</p>
          <p role="status" aria-atomic="true" className="text-sm text-muted">
            {labels.counts[sightings.length]}
          </p>
        </div>
        <p className="mt-1 text-sm text-muted">{labels.identify}</p>
        <span id={loggedDescriptionId} className="sr-only">
          {labels.logged}
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {SPECIES.map((index) => (
            <button
              key={index}
              type="button"
              data-try-tap=""
              aria-pressed={selected === index}
              aria-label={labels.species[index].inspect}
              aria-describedby={sightings.includes(index) ? loggedDescriptionId : undefined}
              onClick={() => onSelect(index)}
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-inset",
              })}
            >
              {sightings.includes(index) ? (
                <StatusMark variant="success" className="text-success" />
              ) : null}
              {labels.species[index].name}
            </button>
          ))}
        </div>
        {selected !== null && animal ? (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-sm font-semibold" id={speciesId}>
              {animal.name}
            </p>
            <p className="mt-1 text-sm leading-5 text-muted">{animal.detail}</p>
            <button
              type="button"
              data-try-tap=""
              aria-describedby={speciesId}
              onClick={() => onUpdate(selected, !logged)}
              className={buttonClass({
                variant: logged ? "secondary" : "primary",
                size: "sm",
                className: "mt-2",
              })}
            >
              {logged ? labels.remove : labels.log}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          data-try-tap=""
          onClick={onSurface}
          className={buttonClass({ variant: "link", size: "sm", flush: true, className: "mt-2" })}
        >
          {labels.surface}
        </button>
      </figcaption>
    </>
  );
}
