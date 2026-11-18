"use client";

import styles from "./MarketingReefScene.module.css";

const animals = [styles.ray, styles.turtle, styles.tang] as const;
type AnimalIndex = 0 | 1 | 2;

export function MarketingReefScene({
  names,
  selected,
  onSelect,
  paused,
  sceneLabel,
}: {
  names: readonly [string, string, string];
  selected: AnimalIndex | null;
  onSelect: (index: AnimalIndex) => void;
  paused: boolean;
  sceneLabel: string;
}) {
  return (
    <fieldset
      aria-label={sceneLabel}
      data-reef-scene=""
      data-paused={paused}
      className={styles.scene}
    >
      <div aria-hidden="true" className={styles.water} />
      {([0, 1, 2] as const).map((index) => (
        <button
          type="button"
          key={animals[index]}
          data-try-tap=""
          aria-label={names[index]}
          aria-pressed={selected === index}
          onClick={() => onSelect(index)}
          className={`${styles.animal} ${animals[index]} focus-visible:focus-ring-inset`}
        >
          <span aria-hidden="true" className={styles.swimmer} />
          <span
            aria-hidden="true"
            className={`${styles.label} rounded-full bg-surface px-2 py-1 text-xs font-medium text-foreground shadow-bed`}
          >
            {names[index]}
          </span>
        </button>
      ))}
    </fieldset>
  );
}
