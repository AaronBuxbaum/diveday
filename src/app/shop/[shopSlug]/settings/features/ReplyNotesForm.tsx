import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { Field, FieldActions, FieldGrid, textareaClassFor } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { REPLY_NOTES_MAX_LENGTH } from "@/lib/assists/inbox";

/**
 * **What AI should know about the shop** (Aaron, 2026-10-22): one box in the
 * shop's own words. It replaced saved answers and their `{name}`/`{trip}`
 * markers: the shop writes a fact once, and the draft on a diver's record
 * (`inbox-draft`) puts it in a reply to whatever the diver asked. It sits
 * under the AI switch on the Features page, drawn only while the shop's
 * assists are lit (Aaron, 2026-10-23): dark, it would be a box nothing reads.
 */
export function ReplyNotesForm({
  notes,
  t,
  action,
  notice,
}: {
  notes: string | null;
  t: StaffTranslator;
  action: (formData: FormData) => Promise<void>;
  notice: React.ReactNode;
}) {
  return (
    <FieldGrid as="form" action={action} columns={1}>
      <h2 className="text-sm font-semibold">{t("settings.main.features.replyNotes.heading")}</h2>
      <Field label={t("settings.main.features.replyNotes.label")}>
        <textarea
          name="notes"
          rows={4}
          maxLength={REPLY_NOTES_MAX_LENGTH}
          defaultValue={notes ?? ""}
          placeholder={t("settings.main.features.replyNotes.placeholder")}
          className={textareaClassFor(4)}
        />
      </Field>
      {notice}
      <FieldActions>
        <SubmitButton
          pendingLabel={t("settings.main.features.replyNotes.saving")}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("settings.main.features.replyNotes.save")}
        </SubmitButton>
      </FieldActions>
    </FieldGrid>
  );
}
