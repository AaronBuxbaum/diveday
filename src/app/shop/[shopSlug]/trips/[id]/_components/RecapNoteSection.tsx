import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, FormStatus } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import type { FormNotice } from "@/lib/staff-notices";
import { EditDisclosure } from "./EditDisclosure";

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
      {/* The note itself is the summary — what will actually ride on every
          diver's recap, readable without opening the form. One line at rest:
          the teaching sentence waits inside the disclosure with the form it
          explains, so the empty state doesn't say "sends none" twice. */}
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {shoutout ?? t("trips.recapNote.emptySummary")}
      </p>
      <EditDisclosure
        label={shoutout ? t("trips.recapNote.edit") : t("trips.recapNote.write")}
        open={Boolean(status)}
      >
        <p className="mt-2 max-w-2xl text-sm text-muted">{t("trips.recapNote.description")}</p>
        <form action={action} className="mt-2 flex flex-col gap-3">
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
      </EditDisclosure>
    </section>
  );
}
