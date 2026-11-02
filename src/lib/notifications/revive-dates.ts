import type { z } from "zod";

/**
 * **Turns a queued payload's date strings back into dates, reading the kind's
 * own schema** (issue #3603). A retry is stored as JSON, where every `Date`
 * became an ISO string; the notification schema wants `z.date()`. A hand-kept
 * list of field names went stale each time a kind gained a date (a seat-moved
 * instant, a recap's fly-safe window, a cancellation time) and that kind's
 * retry could then never send. The schema already says which fields are
 * dates, so it is the only list.
 *
 * Only a string at a date position becomes a `Date`; an invalid one is left as
 * it is, so validation refuses the row exactly as it always did.
 */
export function reviveDates(schema: z.ZodType, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
  const child = (key: string) => def[key] as z.ZodType;
  switch (def.type) {
    case "date": {
      if (typeof value !== "string") return value;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date;
    }
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "nonoptional":
      return reviveDates(child("innerType"), value);
    case "pipe":
      return reviveDates(child("in"), value);
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return value;
      const shape = def.shape as Record<string, z.ZodType>;
      const copy = { ...(value as Record<string, unknown>) };
      for (const [key, field] of Object.entries(shape)) {
        if (key in copy) copy[key] = reviveDates(field, copy[key]);
      }
      return copy;
    }
    case "array":
      return Array.isArray(value)
        ? value.map((item) => reviveDates(child("element"), item))
        : value;
    case "intersection":
      return reviveDates(child("right"), reviveDates(child("left"), value));
    case "union": {
      const options = def.options as z.ZodType[];
      const key = typeof def.discriminator === "string" ? def.discriminator : null;
      const tag = key && typeof value === "object" ? (value as Record<string, unknown>)[key] : null;
      // A tagged union names its branch; read that branch, valid payload or not,
      // so a date is revived whatever else is wrong with the row.
      const branch = key ? options.find((option) => carriesTag(option, key, tag)) : undefined;
      if (branch) return reviveDates(branch, value);
      for (const option of options) {
        const revived = reviveDates(option, value);
        if (option.safeParse(revived).success) return revived;
      }
      return value;
    }
    default:
      return value;
  }
}

/** Whether a union branch (or a branch of a nested union) is the one tagged `tag` under `key`. */
function carriesTag(option: z.ZodType, key: string, tag: unknown): boolean {
  const def = (option as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
  if (def.type === "union") {
    return (def.options as z.ZodType[]).some((inner) => carriesTag(inner, key, tag));
  }
  if (def.type !== "object") return false;
  const field = (def.shape as Record<string, z.ZodType>)[key];
  const values = (field as unknown as { _zod: { def: { values?: unknown[] } } } | undefined)?._zod
    .def.values;
  return Array.isArray(values) && values.includes(tag);
}
