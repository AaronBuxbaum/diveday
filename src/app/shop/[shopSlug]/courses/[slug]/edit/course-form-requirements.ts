import { z } from "zod";
import type { AppDb } from "@/db/client";
import { courseFormListRefusal, setCourseFormRequirements } from "@/db/course-forms";
import { readForm, text, trimmedText } from "@/features/form-parse";

/** Each form's place in the order is posted as `order-<formId>`. */
const formOrderFields = z.object({}).catchall(text());

/** The `?notice=` a refused forms list answers with, beside the forms section. */
export type CourseFormsRefusal = "forms-invalid" | "forms-invalid-age" | "forms-medical-age";

export type CourseFormsWrite = Parameters<typeof setCourseFormRequirements>[1];

/**
 * **The forms this course asks each student to sign** (ADR
 * 20261008-course-forms), read off the course editor's one form. A list of
 * this shop's live course forms, in the order the student meets them: each
 * ticked box posts `formId`, and its `order-<id>` box says where it goes
 * (blank or nonsense sorts last, ties keep the page's order).
 *
 * Planned before anything is written, so a refused list refuses the editor's
 * whole save (visual review 2026-10-24, A11, which folded the section's own
 * form and Save into the editor's one): the gates, the ages, and what the
 * list names (`courseFormListRefusal`) are all asked here.
 * `setCourseFormRequirements` still has the last word, atomic with the write;
 * only a race (a form deleted, or a role changed, between the two) can refuse
 * there, after the page's own fields have saved.
 *
 * The whole editor is the owner's or manager's (`canEditCourseTemplates`), gated
 * by the save before this runs, so every list that reaches here may narrow too.
 */
export async function planCourseFormRequirements(
  db: AppDb,
  staff: { shopId: string; personId: string },
  courseId: string,
  formData: FormData,
): Promise<{ ok: true; write: CourseFormsWrite } | { ok: false; notice: CourseFormsRefusal }> {
  const ids = formData.getAll("formId").map(String);
  if (!ids.every((id) => z.uuid().safeParse(id).success)) {
    return { ok: false, notice: "forms-invalid" };
  }
  const orderFields = readForm(formOrderFields, formData);
  const orderOf = (id: string) => {
    const value = Number.parseInt(orderFields[`order-${id}`] ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
  };
  const ordered = ids
    .map((id, index) => ({ id, index, order: orderOf(id) }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((entry) => entry.id);
  // The optional age under each ticked form (issue #2265): blank asks every
  // student; anything else that is not a whole age in range refuses the save.
  const maxAgeYears = new Map<string, number>();
  const maxAges = readForm(
    z.object(Object.fromEntries(ordered.map((id) => [`maxAge-${id}`, trimmedText()]))),
    formData,
  );
  for (const id of ordered) {
    const raw = maxAges[`maxAge-${id}`] ?? "";
    if (raw === "") continue;
    const age = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(age)) return { ok: false, notice: "forms-invalid-age" };
    maxAgeYears.set(id, age);
  }

  // What the list names is checked now, not only inside the write: the editor
  // writes the page and its prices before the forms, so a refusal found only
  // there would land after them (dive-domain review, visual review 2026-10-24).
  const named = await courseFormListRefusal(db, staff.shopId, ordered, maxAgeYears);
  if (named) {
    return {
      ok: false,
      notice: (
        {
          invalid_age: "forms-invalid-age",
          medical_bound: "forms-medical-age",
          unknown_form: "forms-invalid",
        } as const
      )[named],
    };
  }

  return {
    ok: true,
    write: { shopId: staff.shopId, courseId, formIds: ordered, maxAgeYears, mayNarrow: true },
  };
}

/** Write a planned list; a refusal the database still has is answered as a notice. */
export async function writeCourseFormRequirements(
  db: AppDb,
  write: CourseFormsWrite,
): Promise<CourseFormsRefusal | null> {
  const result = await setCourseFormRequirements(db, write);
  if (result.ok) return null;
  return (
    {
      invalid_age: "forms-invalid-age",
      medical_bound: "forms-medical-age",
      not_authorized: "forms-invalid",
      not_found: "forms-invalid",
      unknown_form: "forms-invalid",
    } as const
  )[result.reason];
}
