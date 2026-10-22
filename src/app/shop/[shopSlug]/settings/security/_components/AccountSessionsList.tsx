import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX } from "@/components/ui/card";

export type AccountSessionDisplayRow = {
  id: string;
  deviceLabel: string;
  isCurrent: boolean;
  lastSeen: string;
  userAgent: string | null;
  ipAddress: string | null;
};

export type AccountSessionsLabels = {
  thisDevice: string;
  details: string;
  /** "Browser: {browser}", whole from the bundle so the translator owns the punctuation. */
  browserLine: (browser: string) => string;
  /** "Network: {network}", likewise. */
  networkLine: (network: string) => string;
  unknownDevice: string;
  unknownIp: string;
  revoke: string;
  revoking: string;
};

type RevokeAction = (shopSlug: string, formData: FormData) => void | Promise<void>;

/**
 * Renders every active session row; the caller supplies account-scoped rows and localized copy.
 * A Server Component, so `labels` can carry the two line formatters.
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
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className={`flex flex-col gap-3 ${INSET_NOTE_BOX} bg-surface-sunken sm:flex-row sm:items-center`}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">{row.lastSeen}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{row.deviceLabel}</span>
              {row.isCurrent ? <Badge tone="success">{labels.thisDevice}</Badge> : null}
            </div>
            <details className="text-sm">
              <summary className="min-h-11 w-fit cursor-pointer py-2 text-muted focus-visible:focus-ring-inset">
                {labels.details}
              </summary>
              <div className="space-y-1 break-all pb-2 text-muted">
                <p>{labels.browserLine(row.userAgent ?? labels.unknownDevice)}</p>
                <p>{labels.networkLine(row.ipAddress ?? labels.unknownIp)}</p>
              </div>
            </details>
          </div>
          <form action={revokeAction.bind(null, shopSlug)} className="shrink-0">
            <input type="hidden" name="sessionId" value={row.id} />
            <SubmitButton
              pendingLabel={labels.revoking}
              className={buttonClass({
                variant: "ghost",
                size: "sm",
                flush: true,
                // The row's inset leaves the flush fill inside its edge; the outset ring would cross it.
                className: "focus-visible:focus-ring-inset",
              })}
            >
              {labels.revoke}
            </SubmitButton>
          </form>
        </li>
      ))}
    </ul>
  );
}
