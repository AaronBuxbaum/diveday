import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoicePill } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
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

export function statusBadge(t: StaffTranslator, row: { status: string } | undefined) {
  if (!row) return <Badge tone="neutral">{t("integrations.status.notConnected")}</Badge>;
  if (row.status === "error") return <Badge tone="danger">{t("integrations.status.error")}</Badge>;
  return <Badge tone="success">{t("integrations.status.connected")}</Badge>;
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

/**
 * A provider this deployment carries no credentials for. One muted line and
 * **no control**: the three pale "Not configured" buttons that stood here read
 * as disabled primaries a shop could fix by clicking, and nothing on this page
 * can fix them (principle 8 — a control that cannot act is not a control).
 */
/**
 * A card whose provider is not switched on. With `askedAbove` the way to ask
 * for it is said once, over the cards, and each card keeps only its state:
 * four cards each ending in the same support address read as a page of
 * repeated small print, worst on a phone where they stack.
 */
export function NotAvailable({ t, askedAbove }: { t: StaffTranslator; askedAbove: boolean }) {
  return (
    <p className="text-sm text-muted">
      {askedAbove
        ? t("integrations.common.notAvailableShort")
        : t("integrations.common.notAvailable", { email: SUPPORT_EMAIL })}
    </p>
  );
}

export function DisconnectForm({
  provider,
  t,
}: {
  provider: "shopify" | "quickbooks" | "xero" | "zapier";
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
