import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { LedgerGroup } from "@/components/ui/ledger";
import type { SavedAnswer } from "@/db/inbox-saved-answers";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **The shop's saved answers, kept where the conversations are** (fifth loop,
 * item 15). Each one as the chip says it and the words it puts in the box,
 * with Delete; deleting is soft, so the ones just deleted wait underneath with
 * Put back. Writing one is "Save this answer" on a diver's record, which is
 * why the empty state teaches that rather than offering a blank form.
 */
export function SavedAnswersSection({
  answers,
  shopSlug,
  deleted,
  t,
  deleteAction,
  restoreAction,
}: {
  answers: readonly SavedAnswer[];
  shopSlug: string;
  deleted: readonly SavedAnswer[];
  t: StaffTranslator;
  deleteAction: (formData: FormData) => Promise<void>;
  restoreAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <section aria-labelledby="saved-answers" className="mt-10 scroll-mt-24">
      <LedgerGroup as="h2" id="saved-answers" label={t("inbox.savedAnswers.heading")}>
        <p className="mb-3 text-sm text-muted">{t("inbox.savedAnswers.empty")}</p>
        <Link
          href={`/shop/${shopSlug}/divers`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("inbox.savedAnswers.openDiver")}
        </Link>
        {answers.length === 0 ? null : (
          <>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {answers.map((answer) => (
                <li key={answer.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{answer.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{answer.body}</p>
                  </div>
                  <form action={deleteAction} className="shrink-0">
                    <input type="hidden" name="answerId" value={answer.id} />
                    <SubmitButton
                      pendingLabel={t("inbox.savedAnswers.deleting")}
                      ariaLabel={t("inbox.savedAnswers.deleteFor", { title: answer.title })}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      {t("inbox.savedAnswers.delete")}
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">{t("inbox.savedAnswers.markersHint")}</p>
          </>
        )}
      </LedgerGroup>
      {deleted.length > 0 ? (
        <LedgerGroup as="h3" label={t("inbox.savedAnswers.deletedHeading")} className="mt-6">
          <ul className="divide-y divide-border border-y border-border">
            {deleted.map((answer) => (
              <li key={answer.id} className="flex items-center gap-3 py-2">
                <p className="min-w-0 flex-1 text-sm text-muted">{answer.title}</p>
                <form action={restoreAction} className="shrink-0">
                  <input type="hidden" name="answerId" value={answer.id} />
                  <SubmitButton
                    pendingLabel={t("inbox.savedAnswers.restoring")}
                    ariaLabel={t("inbox.savedAnswers.restoreFor", { title: answer.title })}
                    className={buttonClass({ variant: "ghost", size: "sm" })}
                  >
                    {t("inbox.savedAnswers.restore")}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </LedgerGroup>
      ) : null}
    </section>
  );
}
