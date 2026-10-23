/**
 * **The medical alert for the crew** (glossary *Medical alert for the crew*,
 * issue #2960): one optional free-text field on the waiver where a diver
 * writes what the boat should know in an emergency, such as an allergy and
 * where the medicine is, diabetes and carried glucose, or an inhaler.
 *
 * It informs and never gates. Nothing here reads what the alert says, and
 * nothing that decides status, medical review, readiness, admission or roll
 * call reads it at all. It never replaces the standard medical questionnaire
 * and nobody reviews it for fitness to dive.
 */

/** The longest alert a diver can give, in characters (UTF-16 code units, as `maxlength` counts). */
export const MEDICAL_ALERT_MAX = 500;

/** The form field the waiver page posts the alert under. */
export const MEDICAL_ALERT_FIELD = "medical_alert";

/**
 * Any C0 control character other than newline, or DEL. Postgres text cannot
 * hold U+0000, and none of the others belongs in a sentence for the crew.
 * Carriage returns are folded into newlines before this is asked.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding control characters is this pattern's whole job.
const CONTROL_CHARACTER = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export type MedicalAlertRefusal = "too_long" | "control_character";

export type MedicalAlertReading =
  | { ok: true; value: string | null }
  | { ok: false; reason: MedicalAlertRefusal };

/**
 * One raw form value read as an alert: newlines folded, NFC, trimmed. Blank
 * is `null`, never `""`, so the seal's conditional key is present exactly
 * when there is something to say.
 */
export function readMedicalAlert(raw: string | null | undefined): MedicalAlertReading {
  const value = (raw ?? "").replace(/\r\n?/g, "\n").normalize("NFC").trim();
  if (value === "") return { ok: true, value: null };
  if (CONTROL_CHARACTER.test(value)) return { ok: false, reason: "control_character" };
  if (value.length > MEDICAL_ALERT_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, value };
}

/**
 * What "Save and finish later" keeps, and what a refused signature keeps so
 * the diver sees their words again: the alert as signing would store it, or,
 * for one signing refuses, the same words with each control character turned
 * into a space and cut at the cap. A draft is not evidence, so it is mended
 * rather than refused; the signature still reads the posted text.
 */
export function readDraftMedicalAlert(raw: string | null | undefined): string | null {
  const reading = readMedicalAlert(raw);
  if (reading.ok) return reading.value;
  const mended = (raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(new RegExp(CONTROL_CHARACTER.source, "g"), " ")
    .normalize("NFC")
    .slice(0, MEDICAL_ALERT_MAX)
    .trim();
  return mended === "" ? null : mended;
}
