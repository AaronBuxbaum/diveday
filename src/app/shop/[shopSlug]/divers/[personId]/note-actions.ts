"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDiverNote, deleteDiverNote } from "@/db/operations";
import { readForm, text } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl } from "@/lib/staff-notices";
import { backTo, requireDiverActionContext } from "./action-helpers";

const noteForm = z.object({ note: text() });
const noteIdForm = z.object({ noteId: text() });
const noteBodyForm = z.object({ body: text() });

/**
 * Add a note to the diver record. The successful path revalidates in place so
 * the new line appears beside the field that was just used; the refusal path
 * lands on the Notes anchor with the same section-scoped status treatment as
 * the other long-form record editors.
 */
export async function addDiverNoteAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-notes",
    "notes",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const note = await addDiverNote(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
    body: readForm(noteForm, formData).note,
  });
  if (!note) {
    revalidateAndRedirect(base, backTo(base, "invalid", "notes"));
    return;
  }
  revalidatePath(base);
}

/** Delete a person-scoped note and carry its text to a one-tap undo toast. */
export async function deleteDiverNoteAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-notes",
    "notes",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const result = await deleteDiverNote(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
    noteId: readForm(noteIdForm, formData).noteId,
  });
  revalidateAndRedirect(
    base,
    result.deleted
      ? noticeUrl(`${base}#notes`, "note-deleted", { noteBody: result.body })
      : backTo(base, "invalid", "notes"),
  );
}

/** Restore a deleted diver note through the same audited insert path. */
export async function restoreDiverNoteAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-notes",
    "notes",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const restored = await addDiverNote(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
    body: readForm(noteBodyForm, formData).body,
  });
  revalidateAndRedirect(base, backTo(base, restored ? "note-added" : "invalid", "notes"));
}
