import { z } from "zod";

/**
 * **What a server action read off its form**, or which fields refused.
 *
 * A result rather than a throw, because every caller already has its own
 * refusal to give — a `?notice=` redirect, a `useActionState` status, a
 * `?tip=invalid` — and those stay exactly as they were: this decides *whether*
 * the form was good, never what the reader is told about it. The failure names
 * the offending fields by name (codes, not sentences — `src/lib` holds no copy),
 * so a caller that marks a field can.
 */
export type FormParse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      fields: string[];
      /**
       * The schema's own messages, in issue order. Only meaningful for a schema
       * whose messages are codes it chose (`onboardSchema`, src/lib/onboarding.ts);
       * zod's defaults are English sentences and never reach a reader.
       */
      messages: string[];
    };

/**
 * `FormData` as a plain object for a schema to read. A name sent once is its
 * value; a name sent more than once (checkboxes sharing a name, a multi-select)
 * is the array of its values in form order, where `Object.fromEntries` would
 * silently keep only the last.
 */
export function formFields(
  formData: FormData,
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const fields: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const name of new Set(formData.keys())) {
    const values = formData.getAll(name);
    fields[name] = values.length === 1 ? (values[0] as FormDataEntryValue) : values;
  }
  return fields;
}

/**
 * Reads a form through a zod schema. Absent fields reach the schema as
 * `undefined`, so `.optional()` and `.default()` mean what they say.
 */
export function parseForm<Schema extends z.ZodType>(
  schema: Schema,
  formData: FormData,
): FormParse<z.infer<Schema>> {
  const parsed = schema.safeParse(formFields(formData));
  if (parsed.success) return { ok: true, data: parsed.data };
  const fields = [
    ...new Set(
      parsed.error.issues.map((issue) => (issue.path.length > 0 ? String(issue.path[0]) : "")),
    ),
  ];
  return { ok: false, fields, messages: parsed.error.issues.map((issue) => issue.message) };
}

/**
 * A field read exactly as `formData.get(name)` read it: its first value when
 * the form sent it more than once, and `null` when it sent nothing. For a
 * field whose action narrows the value itself (an enum guard, a honeypot, a
 * value echoed back into the form), where a schema of its own would only
 * restate that narrowing.
 */
export function formValue() {
  return z.unknown().optional().transform(firstEntry);
}

function firstEntry(value: unknown): FormDataEntryValue | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" || first instanceof File ? first : null;
}

/**
 * A field read as `String(formData.get(name) ?? "")` read it: its first value
 * as a string, and `""` when the form sent nothing. For an id or a word the
 * action looks up or compares, so a missing one is simply not found.
 */
export function text() {
  return z
    .unknown()
    .optional()
    .transform((value) => String(firstEntry(value) ?? ""));
}

/**
 * Every value a repeated field sent, in form order, as `FormData.getAll` read
 * it: `[]` when the form sent none.
 */
export function allValues() {
  return z
    .unknown()
    .optional()
    .transform((value): FormDataEntryValue[] =>
      (value === undefined ? [] : Array.isArray(value) ? value : [value]).filter(
        (entry): entry is FormDataEntryValue => typeof entry === "string" || entry instanceof File,
      ),
    );
}

/**
 * A text box read as `String(formData.get(name) ?? "").trim()` read it: its
 * first value trimmed, and `""` when the form sent nothing. For an action that
 * measures the text itself, so it can point at the box that is wrong.
 */
export function trimmedText() {
  return z
    .unknown()
    .optional()
    .transform((value) => String(firstEntry(value) ?? "").trim());
}

/**
 * {@link parseForm} for a schema built only of fields that cannot refuse
 * ({@link formValue}, {@link text}, {@link trimmedText}, {@link checkbox}):
 * the reading itself, with the impossible refusal thrown rather than handled
 * at every caller.
 */
export function readForm<Schema extends z.ZodType>(
  schema: Schema,
  formData: FormData,
): z.infer<Schema> {
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) throw new Error(`form refused: ${parsed.fields.join(", ")}`);
  return parsed.data;
}

/**
 * A field read by its first value, as `FormData.get` read it, and held to
 * `schema`: a name the form sent twice reaches `schema` once rather than as an
 * array, and an absent one reaches it as `absent` — `undefined` unless the
 * action read a missing field as something else (`formData.get(name) ?? ""`).
 */
export function single<Schema extends z.ZodType>(schema: Schema, absent?: string) {
  return z.preprocess((value) => {
    const first = Array.isArray(value) ? value[0] : value;
    return first === undefined ? absent : first;
  }, schema);
}

/**
 * A field that may be left blank: an empty box and an absent field both read
 * as `undefined`, exactly as `formData.get(name) || undefined` did, and
 * anything else must satisfy `schema`.
 */
export function blankAsAbsent<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess((value) => firstEntry(value) || undefined, schema.optional());
}

/**
 * A checkbox: on when the browser sent `"on"` (or the value a form names),
 * off when it sent nothing — the reading `formData.get(name) === "on"` gave.
 */
export function checkbox(on = "on") {
  return z
    .unknown()
    .optional()
    .transform((value) => firstEntry(value) === on);
}

/**
 * The one shape every CSV importer posts: a single non-empty file named
 * `file`. An empty pick and no pick at all are the same refusal.
 */
export const csvUploadForm = z.object({
  file: z.instanceof(File).refine((file) => file.size > 0),
});
