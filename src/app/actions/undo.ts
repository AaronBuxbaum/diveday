"use server";

import { notFound } from "next/navigation";
import { formFields } from "@/features/form-parse";
import { requireShopSurface } from "@/features/session";
import { readUndoOffer } from "@/features/undo";
import { takeBack } from "./undo-registry";

/**
 * **The one Undo** (issue #2764): every land-then-undo toast posts here, with
 * the offer its removal landed with (`src/features/undo/rules.ts`) as hidden fields.
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
