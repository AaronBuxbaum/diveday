"use server";

/** The departure's internal notes: add one, delete it softly, and put it back. */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { addInternalNote, deleteInternalNote } from "@/db/operations";
import { readForm, text } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { requireRosterBooking, tripPath } from "./roster-booking";

const addNoteForm = z.object({ bookingId: text(), note: text() });
const deleteNoteForm = z.object({ noteId: text() });
const restoreNoteForm = z.object({ bookingId: text(), body: text() });

/**
 * Adds a note **without navigating.** A note is written from a textarea inside
 * an open `<details>` two thirds of the way down a roster card, and the
 * `revalidateAndRedirect(...?notice=note-added)` this used to end with was a
 * real navigation: the page returned scrolled to its top with every disclosure
 * on it shut, so the staffer who had just written one note about diver seven
 * had to find diver seven again to write the second. `revalidatePath` alone
 * re-renders the same page in place — the note appears in the list directly
 * above the box it was typed in, which is the confirmation the banner was
 * standing in for (docs/design/forms-and-controls.md; design principle 9).
 * The form is keyed on the note count in `RosterSection`, so landing one
 * clears the box.
 *
 * A refusal still redirects: an empty or over-long note leaves nothing on the
 * page to read the outcome from, so it keeps the banner it has always had.
 */
export async function addInternalNoteAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const { bookingId, note: body } = readForm(addNoteForm, formData);
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, noticeUrl(back, "invalid"));
  const saved = await addInternalNote(dbi, {
    shopId: s.user.shopId,
    tripId,
    actorPersonId: s.user.personId,
    bookingId,
    body,
  });
  if (!saved) revalidateAndRedirect(back, noticeUrl(back, "invalid"));
  revalidatePath(back);
}

/**
 * Land-then-undo (docs/design/principles.md §7): the note is a purely
 * reversible edit — recreating it is exactly what a text note supports — so
 * this lands immediately instead of holding for a blocking confirm. The
 * deleted booking + text ride along in the redirect so the toast on the next
 * render can offer a one-tap restore.
 */
export async function deleteInternalNoteAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const { noteId } = readForm(deleteNoteForm, formData);
  const result = await deleteInternalNote(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    actorPersonId: s.user.personId,
    noteId,
  });
  revalidateAndRedirect(
    back,
    result.deleted
      ? // The booking and the note's text ride along so the next render can offer
        // the one-tap restore; `noticeUrl` percent-encodes both, which is what the
        // hand-rolled `encodeURIComponent` here used to do for the body alone.
        noticeUrl(back, "note-deleted", {
          noteBookingId: result.bookingId,
          noteBody: result.body,
        })
      : noticeUrl(back, "invalid"),
  );
}

/**
 * Undo a note delete from the land-then-undo toast. Recreates a *new* note
 * with the same booking and text through the same `addInternalNote`
 * insert-and-log path a fresh note takes — the deleted row's id is gone and
 * isn't needed for that, since this doesn't resurrect the old row.
 */
export async function restoreInternalNoteAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const { bookingId, body } = readForm(restoreNoteForm, formData);
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, noticeUrl(back, "invalid"));
  const restored = await addInternalNote(dbi, {
    shopId: s.user.shopId,
    tripId,
    actorPersonId: s.user.personId,
    bookingId,
    body,
  });
  // Reuses the "note-added" notice: a restore is, from the banner's
  // perspective, indistinguishable from adding a fresh note with the same
  // text — no dedicated "note-restored" code needed.
  revalidateAndRedirect(back, noticeUrl(back, restored ? "note-added" : "invalid"));
}
