import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **The card refunds a call-off left waiting** (H-139): seats still holding a
 * payment on a canceled departure, because the person who called it off could
 * not move money. An owner or manager sends them back from here; anyone else
 * is told who will.
 */
export function HeldRefundsCard({
  count,
  mayRefund,
  releaseAction,
  t,
}: {
  count: number;
  mayRefund: boolean;
  releaseAction: () => Promise<void>;
  t: StaffTranslator;
}) {
  if (count === 0) return null;
  return (
    <SectionCard as="div" padding="lg" className="mb-6">
      <p className="text-sm font-medium">{t("blowout.record.heldHeading", { count })}</p>
      {mayRefund ? (
        <form action={releaseAction} className="mt-3">
          <p className="mb-3 text-sm text-muted">{t("blowout.record.heldRelease")}</p>
          <SubmitButton
            pendingLabel={t("blowout.record.releasing")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("blowout.record.release")}
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-1 text-sm text-muted">{t("blowout.record.heldWaiting")}</p>
      )}
    </SectionCard>
  );
}
