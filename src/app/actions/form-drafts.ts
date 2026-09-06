"use server";

import { getDb } from "@/db/client";
import { discardFormDraft, saveFormDraft } from "@/db/form-drafts";
import { isFormDraftKind } from "@/lib/form-drafts";
import { requireStaffSession } from "@/lib/session";

/**
 * The two moves of a form draft (ADR 20260906-before-you-ask, decision 3):
 * keep what was typed, and Start over. Both read the person and shop off the
 * session; a draft is never addressed by id from the client.
 */
export async function saveFormDraftAction(
  form: string,
  fields: Array<[string, string]>,
): Promise<void> {
  if (!isFormDraftKind(form)) return;
  const session = await requireStaffSession();
  await saveFormDraft(await getDb(), {
    shopId: session.user.shopId,
    personId: session.user.personId,
    form,
    fields,
  });
}

export async function discardFormDraftAction(form: string): Promise<void> {
  if (!isFormDraftKind(form)) return;
  const session = await requireStaffSession();
  await discardFormDraft(await getDb(), session.user.shopId, session.user.personId, form);
}
