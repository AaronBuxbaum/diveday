import type { StatusMarkVariant } from "./StatusMark";

/** Every tone name the status-bearing UI consumers use. */
export type ToneName = "primary" | "neutral" | "success" | "warning" | "danger";

/**
 * Maps a semantic tone to the shared drawn mark. Counts and plain labels stay
 * unmarked; the caller supplies the words that explain every marked state.
 */
export function toneMark(tone: ToneName): StatusMarkVariant | undefined {
  return tone === "success" || tone === "warning" || tone === "danger" ? tone : undefined;
}
