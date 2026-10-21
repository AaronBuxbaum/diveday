import type { FormDraftProps } from "@/components/FormDraft";
import type { FormDraft } from "@/db/form-drafts";
import type { DiveDaySession } from "@/lib/auth";
import { formatTime } from "@/lib/format";
import { discardFormDraftAction, saveFormDraftAction } from "./form-drafts";

/** Keep the form's client state and both mutation capabilities on one identity. */
export function bindFormDraft(user: DiveDaySession["user"]) {
  const origin = { shopId: user.shopId, personId: user.personId, sessionId: user.sessionId };
  return {
    scope: `${origin.shopId}:${origin.personId}:${origin.sessionId ?? ""}`,
    actions: {
      save: saveFormDraftAction.bind(null, origin),
      discard: discardFormDraftAction.bind(null, origin),
    },
  };
}

/** The server row becomes only the fields and shop-local time the form needs. */
export function draftForForm(
  draft: FormDraft | null,
  locale: string,
  timeZone: string,
): FormDraftProps["draft"] {
  return draft
    ? { fields: draft.fields, savedAtLabel: formatTime(draft.savedAt, locale, timeZone) }
    : null;
}
