import type { ReactNode } from "react";
import { CheckInQueueRefresh } from "../_arrivals/CheckInQueueRefresh";

/**
 * Pull-to-refresh while the desk is open — a phone at the counter re-reads the
 * list with the same gesture the boat's roll call uses. The rest of the week
 * the roster is an ordinary page, and its stack lies in the page's flow.
 */
export function DeskRefresh({
  open,
  copy,
  children,
}: {
  open: boolean;
  copy: { pulling: string; release: string; refreshing: string };
  children: ReactNode;
}) {
  if (!open) return <>{children}</>;
  return (
    <CheckInQueueRefresh copy={copy}>
      <div className="space-y-10">{children}</div>
    </CheckInQueueRefresh>
  );
}
