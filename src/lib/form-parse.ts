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
export type FormParse<T> = { ok: true; data: T } | { ok: false; fields: string[] };

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
  return { ok: false, fields };
}

/**
 * The one shape every CSV importer posts: a single non-empty file named
 * `file`. An empty pick and no pick at all are the same refusal.
 */
export const csvUploadForm = z.object({
  file: z.instanceof(File).refine((file) => file.size > 0),
});
