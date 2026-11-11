import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import type { getSquareReceiptState, SquareReceiptResult } from "@/features/integrations";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { linkSquareReceiptAction, releaseSquareReceiptAction } from "../square-actions";

const outcomes: (SquareReceiptResult | "deleted")[] = [
  "matched",
  "deleted",
  "not_connected",
  "unavailable",
  "invalid",
  "already_linked",
  "not_completed",
  "location_mismatch",
  "amount_mismatch",
  "refund_mismatch",
];
export function SquareReceiptCard({
  state,
  orderId,
  notice,
  t,
  locale,
  timezone,
  matchable = true,
}: {
  state: Awaited<ReturnType<typeof getSquareReceiptState>>;
  orderId: string;
  notice?: string;
  t: StaffTranslator;
  locale: string;
  timezone: string;
  matchable?: boolean;
}) {
  if ((!state.connected || !matchable) && !state.link && notice !== "square-deleted") return null;
  const outcome = outcomes.find((candidate) => notice === `square-${candidate}`);
  const evidence = state.link?.evidence;
  return (
    <SectionCard
      title={t("integrations.square.receiptTitle")}
      description={t("integrations.square.receiptHelp")}
    >
      {!state.connected ? (
        <FormStatus tone="warning">{t("integrations.square.outcome.not_connected")}</FormStatus>
      ) : null}
      <FieldGrid as="form" action={linkSquareReceiptAction}>
        <input type="hidden" name="orderId" value={orderId} />
        {evidence && state.link ? (
          <>
            <input type="hidden" name="paymentId" value={evidence.paymentId} />
            <p className="break-all text-sm">{evidence.paymentId}</p>
            <p className="text-sm text-muted">
              {t("integrations.square.checked", {
                when: formatDateTimeTz(state.link.checkedAt, locale, timezone),
              })}
            </p>
          </>
        ) : (
          <Field
            label={t("integrations.square.paymentId")}
            description={t("integrations.square.paymentIdHelp")}
          >
            <input
              name="paymentId"
              className={controlClass}
              required
              maxLength={192}
              autoComplete="off"
            />
          </Field>
        )}
        {state.link?.lastError && !outcome ? (
          <FormStatus tone="warning">{t("integrations.square.needsCheck")}</FormStatus>
        ) : null}
        {outcome ? (
          <FormStatus tone={outcome === "matched" || outcome === "deleted" ? "success" : "warning"}>
            {t(`integrations.square.outcome.${outcome}`)}
          </FormStatus>
        ) : null}
        <FieldActions>
          <SubmitButton
            disabled={!state.connected || !matchable}
            className={buttonClass({ variant: "secondary" })}
            pendingLabel={t("integrations.square.checking")}
          >
            {t(evidence ? "integrations.square.recheck" : "integrations.square.link")}
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
      {evidence ? (
        <form action={releaseSquareReceiptAction} className="mt-5">
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="paymentId" value={evidence.paymentId} />
          <SubmitButton
            pendingLabel={t("integrations.square.deleting")}
            className={buttonClass({ variant: "danger", size: "sm" })}
          >
            {t("integrations.square.deleteLink")}
          </SubmitButton>
        </form>
      ) : null}
    </SectionCard>
  );
}
