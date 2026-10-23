import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { Field, FieldActions, textareaClassFor } from "@/components/ui/form";
import { LedgerGroup } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { REPLY_NOTES_MAX_LENGTH } from "@/lib/assists/inbox";
import { shopPath } from "@/lib/staff-notices";

/**
 * **What Claude should know when it drafts a reply** (Aaron, 2026-10-22): one
 * box in the shop's own words, kept where the conversations are. It replaced
 * saved answers and their `{name}`/`{trip}` markers: the shop writes a fact
 * once, and the draft on a diver's record (`inbox-draft`) puts it in a reply
 * to whatever the diver asked. With the shop's Claude suggestions off, the box
 * still saves, and a line says where to turn them on.
 */
export function ReplyNotesSection({
  notes,
  assists,
  shopSlug,
  t,
  action,
}: {
  notes: string | null;
  assists: boolean;
  shopSlug: string;
  t: StaffTranslator;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <section aria-labelledby="reply-notes" className="mt-10 scroll-mt-24">
      <LedgerGroup as="h2" id="reply-notes" label={t("inbox.replyNotes.heading")}>
        <form action={action} className="grid gap-3">
          <Field label={t("inbox.replyNotes.label")} description={t("inbox.replyNotes.hint")}>
            <textarea
              name="notes"
              rows={4}
              maxLength={REPLY_NOTES_MAX_LENGTH}
              defaultValue={notes ?? ""}
              placeholder={t("inbox.replyNotes.placeholder")}
              className={textareaClassFor(4)}
            />
          </Field>
          {assists ? null : (
            <p className="text-sm text-muted">
              {t("inbox.replyNotes.off")}{" "}
              <Link
                href={shopPath(shopSlug, "settings", "features")}
                className="font-medium text-primary hover:underline"
              >
                {t("inbox.replyNotes.turnOn")}
              </Link>
            </p>
          )}
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
