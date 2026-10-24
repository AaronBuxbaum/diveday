import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoicePill } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { disconnectIntegrationAction } from "./actions";
import { EVENT_OPTIONS, type EventLabelKey } from "./event-options";

export function EventCheckboxes({
  t,
  selected,
}: {
  t: StaffTranslator;
  selected: readonly string[];
}) {
  return (
    <ChoiceFieldset
      legend={t("integrations.common.selectedEvents")}
      bodyClassName="grid gap-2 sm:grid-cols-3"
    >
      {EVENT_OPTIONS.map((event) => (
        <ChoicePill
          key={event.value}
          type="checkbox"
          name="eventType"
          value={event.value}
          defaultChecked={selected.includes(event.value)}
        >
          {t(event.label as EventLabelKey)}
        </ChoicePill>
      ))}
    </ChoiceFieldset>
  );
}

/**
 * A card's description, then its state as a line of text under it (visual
 * review 2026-10-24, A20): a pill on every card that said the same thing was
 * a row of labels, not news. Only a connection that needs attention takes ink.
 */
export function describedWithStatus(
  t: StaffTranslator,
  description: string,
  row: { status: string } | undefined,
) {
  const status = !row
    ? t("integrations.status.notConnected")
    : row.status === "error"
      ? t("integrations.status.error")
      : t("integrations.status.connected");
  return (
    <>
      <span className="block">{description}</span>
      <span
        className={`mt-1 block font-medium ${row?.status === "error" ? "text-danger" : "text-foreground"}`}
      >
        {status}
      </span>
    </>
  );
}

export function ConnectedMeta({
  t,
  row,
  locale,
  timezone,
}: {
  t: StaffTranslator;
  row: {
    externalAccountId: string | null;
    externalLabel: string | null;
    connectedAt: Date;
    lastSyncedAt: Date | null;
  };
  locale: string;
  timezone: string;
}) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted">{t("integrations.status.account")}</dt>
        <dd>{row.externalLabel ?? row.externalAccountId ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-muted">{t("integrations.status.connectedAt")}</dt>
        <dd>{formatDateTimeTz(row.connectedAt, locale, timezone)}</dd>
      </div>
      {row.lastSyncedAt ? (
        <div>
          <dt className="text-muted">{t("integrations.status.lastSynced")}</dt>
          <dd>{formatDateTimeTz(row.lastSyncedAt, locale, timezone)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function DisconnectForm({
  provider,
  t,
}: {
  provider: "shopify" | "quickbooks" | "zapier";
  t: StaffTranslator;
}) {
  return (
    <form action={disconnectIntegrationAction}>
      <input type="hidden" name="provider" value={provider} />
      <SubmitButton
        pendingLabel={t("integrations.common.disconnecting")}
        className={buttonClass({ variant: "danger", size: "sm" })}
      >
        {t("integrations.common.disconnect")}
      </SubmitButton>
    </form>
  );
}
