/** What the call-note action answers: the form's own fields, and the diver they matched. */
export type CallNoteReading = {
  fields: Record<string, string>;
  match: { name: string; href: string } | null;
};

/**
 * The scribble's longest, so the note it lands in still fits the Took-a-call
 * form's own 1,500 with the callback line after it. A plain module rather than
 * an export of `CallNoteAssist`, because a value imported from a client module
 * into the server action would arrive as a client reference, not a number.
 */
export const CALL_NOTE_MAX = 1_200;
