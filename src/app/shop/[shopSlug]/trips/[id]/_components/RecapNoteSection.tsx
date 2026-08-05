import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, FormStatus } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import type { FormNotice } from "@/lib/staff-notices";

/**
 * The crew-authored post-trip shout-out. Diver-facing and post-trip, so it sits
 * apart from the pre-trip conditions briefing: it rides along on every diver's
 * recap once the trip departs (20260723-post-trip-recap follow-up). Blank sends
 * none — the recap simply omits the block.
 */
export function RecapNoteSection({
  action,
  status,
  shoutout,
  locale,
}: {
  action: (formData: FormData) => void;
  /** This form's own outcome, rendered beside its Save button. */
  status?: FormNotice;
  shoutout: string | null;
  locale: string;
}) {
  const t = staffTranslator(locale);
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{t("trips.recapNote.heading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("trips.recapNote.description")}</p>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <textarea
          name="recapShoutout"
          rows={3}
          maxLength={400}
          defaultValue={shoutout ?? ""}
          placeholder={t("trips.recapNote.placeholder")}
          className={controlClass}
        />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel={t("trips.recapNote.saving")} className={buttonClass()}>
            {t("trips.recapNote.save")}
          </SubmitButton>
          <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
        </div>
      </form>
    </section>
  );
}
