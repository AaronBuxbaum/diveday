import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupSessions, SESSION_GROUPS_SHOWN, type SessionGroup } from "./group-sessions";

export type AccountSessionDisplayRow = {
  id: string;
  deviceLabel: string;
  isCurrent: boolean;
  /** When the session was last seen, for grouping and ordering. */
  lastSeenAt: Date;
  /** The same instant, worded: "last seen Oct 23, 10:04 AM EDT". */
  lastSeen: string;
  userAgent: string | null;
  ipAddress: string | null;
};

export type AccountSessionsLabels = {
  thisDevice: string;
  /** "Browser: {browser}", whole from the bundle so the translator owns the punctuation. */
  browserLine: (browser: string) => string;
  /** "Network: {network}", likewise. */
  networkLine: (network: string) => string;
  unknownDevice: string;
  unknownIp: string;
  revoke: string;
  revoking: string;
  /** "{count} sessions · last seen {when}", for one device's group. */
  group: (count: number, lastSeenAt: Date) => string;
  showSessions: string;
  showAll: string;
};

type RevokeAction = (shopSlug: string, formData: FormData) => void | Promise<void>;

const SUMMARY_CLASS =
  "flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 py-2 text-sm font-medium text-primary focus-visible:focus-ring-inset [&::-webkit-details-marker]:hidden";

/**
 * Every active session, one row per device (visual review 2026-10-24, A03):
 * "Chrome · Linux", how many sessions and when one was last seen, and each
 * session's own Revoke inside the row's "Show sessions". The five most
 * recently seen devices show; "Show all" opens the rest. A Server Component,
 * so `labels` can carry the line formatters.
 */
export function AccountSessionsList({
  rows,
  labels,
  shopSlug,
  revokeAction,
}: {
  rows: readonly AccountSessionDisplayRow[];
  labels: AccountSessionsLabels;
  shopSlug: string;
  revokeAction: RevokeAction;
}) {
  const groups = groupSessions(rows);
  const shown = groups.slice(0, SESSION_GROUPS_SHOWN);
  const rest = groups.slice(SESSION_GROUPS_SHOWN);
  const list = (items: SessionGroup<AccountSessionDisplayRow>[]) => (
    <ul className="divide-y divide-border">
      {items.map((group) => (
        <SessionGroupRow
          key={group.deviceLabel}
          group={group}
          labels={labels}
          shopSlug={shopSlug}
          revokeAction={revokeAction}
        />
      ))}
    </ul>
  );
  return (
    <div className="border-y border-border">
      {list(shown)}
      {rest.length > 0 ? (
        <details className="group/all border-t border-border">
          <summary className={SUMMARY_CLASS}>
            {labels.showAll}
            <DisclosureCaret className="group-open/all:rotate-90" />
          </summary>
          {list(rest)}
        </details>
      ) : null}
    </div>
  );
}

function SessionGroupRow({
  group,
  labels,
  shopSlug,
  revokeAction,
}: {
  group: SessionGroup<AccountSessionDisplayRow>;
  labels: AccountSessionsLabels;
  shopSlug: string;
  revokeAction: RevokeAction;
}) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{group.deviceLabel}</span>
        {group.isCurrent ? <Badge tone="success">{labels.thisDevice}</Badge> : null}
      </div>
      <p className="text-sm text-muted">{labels.group(group.sessions.length, group.lastSeenAt)}</p>
      <details className="group/sessions">
        <summary className={SUMMARY_CLASS}>
          {labels.showSessions}
          <DisclosureCaret className="group-open/sessions:rotate-90" />
        </summary>
        <ul className="space-y-3 pb-2">
          {group.sessions.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 border-s-2 border-border ps-3 sm:flex-row sm:items-start"
            >
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span>{row.lastSeen}</span>
                  {row.isCurrent ? (
                    <Badge tone="success" size="sm">
                      {labels.thisDevice}
                    </Badge>
                  ) : null}
                </p>
                <div className="space-y-1 break-all text-muted">
                  <p>{labels.browserLine(row.userAgent ?? labels.unknownDevice)}</p>
                  <p>{labels.networkLine(row.ipAddress ?? labels.unknownIp)}</p>
                </div>
              </div>
              <form action={revokeAction.bind(null, shopSlug)} className="shrink-0">
                <input type="hidden" name="sessionId" value={row.id} />
                <SubmitButton
                  pendingLabel={labels.revoking}
                  className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
                >
                  {labels.revoke}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
