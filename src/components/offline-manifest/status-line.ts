/**
 * **A saved row's one status line** (visual review 2026-10-24, B01): the
 * person's roll-call state first, then each fact the chips beside the name
 * used to carry, in their order, joined by " · ". A pure join, so nothing a
 * chip said can fall off the line: an absent fact is `null` and skipped, and
 * every present one is said.
 *
 * - **Blocked stays blocked.** A diver readiness had not cleared when the copy
 *   was saved carries readiness's own reasons; a block with no reason saved
 *   still says the blocked word, never nothing.
 */
export function offlineDiverStatusLine(parts: {
  /** "To call", "Boarded · waiting to send", "Not back aboard". */
  stateWord: string;
  /** `null` when readiness cleared them; the saved reasons otherwise. */
  blockerTexts: readonly string[] | null;
  /** "Blocked": said when a block carries no reason. */
  blockedWord: string;
  notHereWord: string | null;
  medicalWord: string | null;
  medicalAlertWord: string | null;
  participantWord: string | null;
  lateWord: string | null;
}): string {
  const blocked =
    parts.blockerTexts === null
      ? []
      : parts.blockerTexts.length > 0
        ? parts.blockerTexts
        : [parts.blockedWord];
  return [
    parts.stateWord,
    ...blocked,
    parts.notHereWord,
    parts.medicalWord,
    parts.medicalAlertWord,
    parts.participantWord,
    parts.lateWord,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}
