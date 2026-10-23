import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { Field, FieldActions, textareaClassFor } from "@/components/ui/form";
import { LedgerGroup } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { REPLY_NOTES_MAX_LENGTH } from "@/lib/assists/inbox";

/**
 * **What AI should know about the shop** (Aaron, 2026-10-22): one box in the
 * shop's own words, kept where the conversations are. It replaced saved answers
 * and their `{name}`/`{trip}` markers: the shop writes a fact once, and the
 * draft on a diver's record (`inbox-draft`) puts it in a reply to whatever the
 * diver asked. The page renders it only while the shop's assists are lit
 * (Aaron, 2026-10-23): with them dark it would be a box nothing reads.
 */
export function ReplyNotesSection({
  notes,
  t,
  action,
}: {
  notes: string | null;
  t: StaffTranslator;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <section aria-labelledby="reply-notes" className="mt-10 scroll-mt-24">
      <LedgerGroup as="h2" id="reply-notes" label={t("inbox.replyNotes.heading")}>
        <form action={action} className="grid gap-3">
          <Field label={t("inbox.replyNotes.label")}>
            <textarea
              name="notes"
              rows={4}
              maxLength={REPLY_NOTES_MAX_LENGTH}
              defaultValue={notes ?? ""}
              placeholder={t("inbox.replyNotes.placeholder")}
              className={textareaClassFor(4)}
            />
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("inbox.replyNotes.saving")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("inbox.replyNotes.save")}
            </SubmitButton>
          </FieldActions>
        </form>
      </LedgerGroup>
    </section>
  );
}
