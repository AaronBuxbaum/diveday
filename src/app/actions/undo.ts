"use server";

import { notFound } from "next/navigation";
import { formFields } from "@/lib/form-parse";
import { requireShopSurface } from "@/lib/session";
import { readUndoOffer } from "@/lib/undo";
import { takeBack } from "./undo-registry";

/**
 * **The one Undo** (issue #2764): every land-then-undo toast posts here, with
 * the offer its removal landed with (`src/lib/undo.ts`) as hidden fields.
 *
 * The slug is bound by the page, so it is checked against the session first
 * (`requireShopSurface`, a 404 for a shop that is not this staffer's). The
 * offer is parsed strictly — a post that names no known kind, or a field its
 * kind does not take, is a 404 rather than a guess — and its inverse
 * (`./undo-registry.ts`) re-runs the removal's own live gate before it writes.
 */
export async function undoAction(shopSlug: string, formData: FormData): Promise<never> {
  await requireShopSurface(shopSlug);
  const offer = readUndoOffer(formFields(formData));
  if (!offer) notFound();
  return takeBack(shopSlug, offer);
}
