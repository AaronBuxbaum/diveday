import { z } from "zod";
import { canPersonConfigureTrips, canPersonManageWaiverTemplates } from "@/db/authz";
import type { AppDb } from "@/db/client";
import {
  courseFormListRefusal,
  listCourseFormAgeBounds,
  listCourseFormRequirements,
  setCourseFormRequirements,
} from "@/db/course-forms";
import { readForm, text, trimmedText } from "@/lib/form-parse";

/** Each form's place in the order is posted as `order-<formId>`. */
const formOrderFields = z.object({}).catchall(text());

/** The `?notice=` a refused forms list answers with, beside the forms section. */
export type CourseFormsRefusal =
  | "forms-not-authorized"
  | "forms-invalid"
  | "forms-invalid-age"
  | "forms-medical-age"
  | "forms-remove-not-authorized";

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
 * Who a course asks for a signature is the same call as who a departure asks
 * for a cert, so the same gate: `canPersonConfigureTrips`, checked here where
 * a POST that skipped the page still lands.
 *
 * **Adding is the trip gate; taking a form off is the release's.** A form a
 * course stops asking for is a signature the shop stops collecting, which is
 * the owner's or manager's call (`canPersonManageWaiverTemplates`, the gate on
 * writing the forms themselves). An instructor may add a form, never drop one.
 */
export async function planCourseFormRequirements(
  db: AppDb,
  staff: { shopId: string; personId: string },
  courseId: string,
  formData: FormData,
): Promise<{ ok: true; write: CourseFormsWrite } | { ok: false; notice: CourseFormsRefusal }> {
  if (!(await canPersonConfigureTrips(db, staff.shopId, staff.personId))) {
    return { ok: false, notice: "forms-not-authorized" };
  }
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

  // **Asking fewer students is taking a form off** (G1): a dropped form, a
  // bound on a form everyone was asked, or a lowered bound is the owner's or
  // manager's call, the same gate as writing the forms themselves.
  const mayNarrow = await canPersonManageWaiverTemplates(db, staff.shopId, staff.personId);
  if (!mayNarrow) {
    const posted = new Set(ordered);
    const [current, currentBounds] = await Promise.all([
      listCourseFormRequirements(db, staff.shopId, courseId),
      listCourseFormAgeBounds(db, staff.shopId, courseId),
    ]);
    const narrows = current.some((formId) => {
      if (!posted.has(formId)) return true;
      const next = maxAgeYears.get(formId);
      const was = currentBounds.get(formId);
      return next !== undefined && (was === undefined || next < was);
    });
    if (narrows) return { ok: false, notice: "forms-remove-not-authorized" };
  }

  return {
    ok: true,
    write: { shopId: staff.shopId, courseId, formIds: ordered, maxAgeYears, mayNarrow },
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
      not_authorized: "forms-remove-not-authorized",
      not_found: "forms-invalid",
      unknown_form: "forms-invalid",
    } as const
  )[result.reason];
}
