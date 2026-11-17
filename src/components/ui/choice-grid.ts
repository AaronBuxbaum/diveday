/**
 * **A grid of `ChoicePill`s** that fits as many 11rem columns as the box allows
 * and wraps the rest, so a label never breaks mid-phrase and no pill is clipped
 * at the edge. A fixed `sm:grid-cols-3` did both in a narrow form column (the
 * get-set-up "What do you run?" boxes, 2026-11-17).
 */
export const choiceGridClass =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2";
