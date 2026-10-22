"use client";

import { useTransition } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * **The one shape a Claude assist takes on screen** (ADR
 * 20261018-claude-assists): a quiet "Draft" button beside a field. A tap runs
 * a server action; the text it returns lands in the field for staff to edit,
 * and nothing is sent or saved until they do. When the assist is dark the
 * action returns `null` and the tap does nothing at all: no error, no
 * notice, because a shop without Claude has lost nothing it relied on.
 *
 * ## Using it
 *
 * 1. **The action** (a sibling `actions.ts`, `"use server"`): authorise from
 *    the session, build the prompt from the database, call `runAssist` from
 *    `@/db/assists` with `session.user.shopId`, and return the text or null.
 *    Return a string only; never throw for a dark or failed assist.
 *
 *    ```ts
 *    export async function draftReplyAction(threadId: string): Promise<string | null> {
 *      const session = await requireStaffSession();
 *      const db = await getDb();
 *      const thread = await getThread(db, session.user.shopId, threadId);
 *      if (!thread) return null;
 *      const value = await runAssist(db, {
 *        shopId: session.user.shopId,
 *        feature: "inbox_draft",
 *        call: { model: "draft", system: REPLY_PROMPT, context, content, schema: Reply },
 *      });
 *      return value?.draft ?? null;
 *    }
 *    ```
 *
 * 2. **The page** (a Server Component): render the button only when
 *    `assistsAvailable(db, shop.id)` is true, so a dark shop never sees a
 *    control. Bind the action's arguments; pass words as props (staff Client
 *    Components take words, never a translator).
 *
 *    ```tsx
 *    {canDraft ? (
 *      <AssistDraftButton
 *        draft={draftReplyAction.bind(null, thread.id)}
 *        fieldId="reply-body"
 *        label={t("inbox.draft")}
 *        pendingLabel={t("inbox.drafting")}
 *      />
 *    ) : null}
 *    <textarea id="reply-body" name="body" />
 *    ```
 *
 * The field is found by `fieldId` and filled the way typing fills it (the
 * native setter plus an `input` event), so an uncontrolled field, a
 * controlled one and `FormDraft`'s saved draft all see the change. A Client
 * Component parent that holds the text itself passes `onDraft` instead.
 */
export function AssistDraftButton({
  draft,
  fieldId,
  onDraft,
  label,
  pendingLabel,
  className,
}: {
  /** A server action answering the draft, or null when the assist is dark or failed. */
  draft: () => Promise<string | null>;
  /** The `id` of the input or textarea the draft fills. */
  fieldId?: string;
  /** For a parent that holds the field's text in state. */
  onDraft?: (text: string) => void;
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      let text: string | null = null;
      try {
        text = await draft();
      } catch {
        // A failed action is a dark assist: the field stays as it was.
        return;
      }
      if (!text?.trim()) return;
      if (onDraft) onDraft(text);
      if (fieldId) fillField(fieldId, text);
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      aria-busy={pending || undefined}
      className={buttonClass({ variant: "ghost", size: "sm", busy: pending, className })}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/** Puts `text` into the field the way typing would, then hands the field focus. */
export function fillField(fieldId: string, text: string): void {
  const field = document.getElementById(fieldId);
  if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) return;
  if (field.disabled || field.readOnly) return;
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  // React tracks a controlled field's value through the prototype's setter;
  // assigning `field.value` directly would be overwritten on the next render.
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus();
}
