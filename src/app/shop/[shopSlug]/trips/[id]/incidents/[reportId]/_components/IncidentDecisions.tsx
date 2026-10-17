import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { FormNotice } from "@/lib/staff-notices";

/**
 * **The two calls only an owner makes about a report** (issue #2391): deleting
 * a draft that should never have been started, and holding a filed report past
 * its seven years. Drawn only for an owner; the writes check it again.
 */

/** Delete an unfiled draft. A filed report has no such door anywhere. */
export function IncidentDiscard({
  action,
  notice,
  t,
}: {
  action: () => Promise<void>;
  notice: FormNotice | undefined;
  t: StaffTranslator;
}) {
  return (
    <SectionCard
      title={t("incidents.discard.title")}
      description={t("incidents.discard.description")}
    >
      <form action={action} className="flex flex-wrap items-center gap-3">
        <InlineConfirm
          triggerLabel={t("incidents.discard.trigger")}
          message={t("incidents.discard.message")}
          confirmLabel={t("incidents.discard.confirm")}
          cancelLabel={t("incidents.discard.cancel")}
          pendingLabel={t("incidents.discard.pending")}
          triggerClassName={buttonClass({ variant: "danger-ghost" })}
          confirmClassName={buttonClass({ variant: "danger" })}
        />
        <FormStatus tone={notice?.tone}>{notice?.text}</FormStatus>
      </form>
    </SectionCard>
  );
}

/** Put a legal hold on a report, or release it: retention skips a held report. */
export function IncidentLegalHold({
  held,
  action,
  notice,
  t,
}: {
  held: boolean;
  action: () => Promise<void>;
  notice: FormNotice | undefined;
  t: StaffTranslator;
}) {
  return (
    <SectionCard
      title={t("incidents.hold.title")}
      description={t(held ? "incidents.hold.descriptionOn" : "incidents.hold.descriptionOff")}
    >
      <form action={action} className="flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel={t("incidents.hold.pending")}
          className={buttonClass({ variant: "secondary" })}
        >
          {t(held ? "incidents.hold.release" : "incidents.hold.set")}
        </SubmitButton>
        <FormStatus tone={notice?.tone}>{notice?.text}</FormStatus>
      </form>
    </SectionCard>
  );
}
