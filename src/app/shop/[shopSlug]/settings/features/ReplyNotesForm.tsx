import { Field, textareaClassFor } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { REPLY_NOTES_MAX_LENGTH } from "@/lib/assists/inbox";
import { REPLY_NOTES_DRAWN_FIELD, REPLY_NOTES_FIELD } from "./save-plan";

/**
 * **What AI should know about the shop** (Aaron, 2026-10-22): one box in the
 * shop's own words. It replaced saved answers and their `{name}`/`{trip}`
 * markers: the shop writes a fact once, and the draft on a diver's record
 * (`inbox-draft`) puts it in a reply to whatever the diver asked. It sits
 * under the AI switch on the Features page, drawn only while the shop's
 * assists are lit (Aaron, 2026-10-23): dark, it would be a box nothing reads.
 *
 * It is part of the page's one form and saves with its one Save (Aaron,
 * 2026-10-23); the hidden marker tells the save the box was drawn, so a page
 * without it leaves the notes as they were.
 */
export function ReplyNotesForm({ notes, t }: { notes: string | null; t: StaffTranslator }) {
  return (
    <>
      <input type="hidden" name={REPLY_NOTES_DRAWN_FIELD} value="on" />
      <h3 className="text-sm font-semibold">{t("settings.main.features.replyNotes.heading")}</h3>
      <Field label={t("settings.main.features.replyNotes.label")}>
        <textarea
          name={REPLY_NOTES_FIELD}
          rows={4}
          maxLength={REPLY_NOTES_MAX_LENGTH}
          defaultValue={notes ?? ""}
          placeholder={t("settings.main.features.replyNotes.placeholder")}
          className={textareaClassFor(4)}
        />
      </Field>
    </>
  );
}
