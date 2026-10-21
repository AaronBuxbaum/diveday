"use server";

import { getDb } from "@/db/client";
import { discardFormDraft, saveFormDraft } from "@/db/form-drafts";
import type { DiveDaySession } from "@/lib/auth";
import { isFormDraftKind } from "@/lib/form-drafts";
import { requireStaffSession } from "@/lib/session";

type DraftOrigin = Pick<DiveDaySession["user"], "shopId" | "personId" | "sessionId">;

function sameOrigin(origin: DraftOrigin, session: DiveDaySession): boolean {
  return (
    origin.shopId === session.user.shopId &&
    origin.personId === session.user.personId &&
    origin.sessionId === session.user.sessionId
  );
}

/**
 * The two moves of a form draft (ADR 20260906-before-you-ask, decision 3):
 * keep what was typed, and Start over. Both read the person and shop off the
 * session; a draft is never addressed by id from the client. The originating
 * identity is bound by the server-rendered form and compared with that live
 * session, so a queued old form cannot write or discard after account changes.
 * Bound values are only a precondition; they never authorize a database target.
 */
export async function saveFormDraftAction(
  origin: DraftOrigin,
  form: string,
  fields: Array<[string, string]>,
): Promise<void> {
  if (!isFormDraftKind(form)) return;
  const session = await requireStaffSession();
  if (!sameOrigin(origin, session)) return;
  await saveFormDraft(await getDb(), {
    shopId: session.user.shopId,
    personId: session.user.personId,
    form,
    fields,
  });
}

export async function discardFormDraftAction(origin: DraftOrigin, form: string): Promise<void> {
  if (!isFormDraftKind(form)) return;
  const session = await requireStaffSession();
  if (!sameOrigin(origin, session)) return;
  await discardFormDraft(await getDb(), session.user.shopId, session.user.personId, form);
}
