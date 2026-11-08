"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDiverNote, deleteDiverNote } from "@/db/operations";
import { readForm, text } from "@/features/form-parse";
import { revalidateAndRedirect } from "@/features/navigation";
import { undoParams } from "@/features/undo";
import { noticeUrl } from "@/lib/staff-notices";
import { backTo, requireDiverActionContext } from "./action-helpers";

const noteForm = z.object({ note: text() });
const noteIdForm = z.object({ noteId: text() });

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

/** Delete a person-scoped note, softly, and offer it back by id as a one-tap Undo (`src/features/undo/rules.ts`). */
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
  const noteId = readForm(noteIdForm, formData).noteId;
  const deleted = await deleteDiverNote(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
    noteId,
  });
  revalidateAndRedirect(
    base,
    deleted
      ? noticeUrl(
          `${base}#notes`,
          "note-deleted",
          undoParams({ undo: "diver-note", undoPerson: personId, undoNote: noteId }) ?? {},
        )
      : backTo(base, "invalid", "notes"),
  );
}
