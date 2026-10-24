/**
 * The form names a Spanish box posts under inside an editor's one form
 * (`spanish-boxes.ts`, `SpanishBoxField`), kept apart from the save so the
 * client field never imports the database.
 */
export function spanishTextName(field: string): string {
  return `spanish.${field}`;
}

/** The digest of the English the posted Spanish was written from, or "". */
export function spanishFromName(field: string): string {
  return `spanishFrom.${field}`;
}
