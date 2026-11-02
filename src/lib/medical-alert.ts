import { hasReturned } from "./trips";
import { shopDayBounds } from "./zoned";

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
 * Any C0 control character other than newline, DEL, or a C1 control. Postgres
 * text cannot hold U+0000, and none of the others belongs in a sentence for
 * the crew. Asked after `fold`, so a tab, a vertical tab, a form feed and a
 * carriage return are already gone and never refuse anything.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding control characters is this pattern's whole job.
const CONTROL_CHARACTER = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

/**
 * Unicode format characters (category Cf): zero-width spaces and joiners, the
 * byte-order mark, and the bidi overrides and isolates that can make "on ton"
 * display as "not no" (security review L1). Stripped, never refused: the
 * diver cannot see them to take them out.
 */
const FORMAT_CHARACTER = /\p{Cf}/gu;

/**
 * **"Nothing" answers** (domain review 2, S3): what divers write in every box
 * on a paper form. Stored as no alert, so the chip on the manifest always
 * means there is something to read. One short list per locale, matched
 * against all of them (a diver may answer in either language on either
 * page), case-insensitively, after trimming and dropping one final period.
 * Only the whole answer: "None, but I carry an EpiPen" is kept.
 */
export const MEDICAL_ALERT_NOTHING_ANSWERS = {
  "en-US": ["none", "n/a", "na", "no", "nothing", "nil"],
  "es-ES": ["ninguna", "ninguno", "nada", "no", "no aplica", "n/a"],
} as const satisfies Record<string, readonly string[]>;

const NOTHING_ANSWERS: ReadonlySet<string> = new Set(
  Object.values(MEDICAL_ALERT_NOTHING_ANSWERS).flat(),
);

function saysNothing(value: string): boolean {
  return NOTHING_ANSWERS.has(value.replace(/\.$/, "").trim().toLocaleLowerCase("en-US"));
}

/**
 * What every reading does before it asks anything: line breaks folded to
 * `\n` (CRLF, CR, U+2028, U+2029), tabs, vertical tabs and form feeds to a
 * space, format characters stripped, NFC.
 */
function fold(raw: string | null | undefined): string {
  return (raw ?? "")
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/[\t\v\f]/g, " ")
    .replace(FORMAT_CHARACTER, "")
    .normalize("NFC");
}

export type MedicalAlertRefusal = "too_long" | "control_character";

export type MedicalAlertReading =
  | { ok: true; value: string | null }
  | { ok: false; reason: MedicalAlertRefusal };

/**
 * One raw form value read as an alert: folded (`fold`), trimmed. Blank, or a
 * bare "nothing" answer, is `null`, never `""`, so the seal's conditional key
 * is present exactly when there is something to say.
 */
export function readMedicalAlert(raw: string | null | undefined): MedicalAlertReading {
  const value = fold(raw).trim();
  if (value === "" || saysNothing(value)) return { ok: true, value: null };
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
  const mended = fold(raw)
    .replace(new RegExp(CONTROL_CHARACTER.source, "g"), " ")
    .slice(0, MEDICAL_ALERT_MAX)
    .trim();
  return mended === "" || saysNothing(mended) ? null : mended;
}

/**
 * Where a departure stands for **"Emergency: show the alert"** (issue #2990,
 * H-20261023-medical-alert-for-the amendment of 2026-10-24): `not_yet` before its start date, `open` on
 * the days of the trip, `closed` after.
 *
 * Open from 00:00 of the date the departure starts in the shop's zone until
 * the later of the end of the date `endsAt` falls on and the moment the
 * departure is marked returned (`hasReturned`). So a night boat still out
 * after midnight and every day of a multi-day trip are covered (domain
 * reviews 1 and 2, B1): a boat at sea is still the trip. The same reading as
 * the *Trip phase*'s Aboard, which also holds a late boat past midnight.
 */
export type EmergencyReadWindow = "not_yet" | "open" | "closed";

export function emergencyReadWindow(
  departure: { startsAt: Date; endsAt: Date },
  timeZone: string,
  now: Date,
): EmergencyReadWindow {
  if (now.getTime() < shopDayBounds(departure.startsAt, timeZone).from.getTime()) {
    return "not_yet";
  }
  const lastDayOver = now.getTime() >= shopDayBounds(departure.endsAt, timeZone).to.getTime();
  return lastDayOver && hasReturned(departure.endsAt, now) ? "closed" : "open";
}
