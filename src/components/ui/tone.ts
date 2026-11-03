import type { StatusMarkVariant } from "./StatusMark";

/** Every tone name the status-bearing UI consumers use. */
export type ToneName = "primary" | "neutral" | "success" | "warning" | "danger";

/** The tones a notice banner draws: every tone but `primary`. */
export type NoticeTone = Extract<ToneName, "success" | "danger" | "warning" | "neutral">;

/**
 * The live-region role a notice of this tone takes: a refusal is an alert, the
 * rest are polite status updates. One rule for every banner and form status.
 */
export function noticeRole(tone: NoticeTone): "status" | "alert" {
  return tone === "danger" ? "alert" : "status";
}

/**
 * Maps a semantic tone to the shared drawn mark. Counts and plain labels stay
 * unmarked; the caller supplies the words that explain every marked state.
 */
export function toneMark(tone: ToneName): StatusMarkVariant | undefined {
  return tone === "success" || tone === "warning" || tone === "danger" ? tone : undefined;
}
