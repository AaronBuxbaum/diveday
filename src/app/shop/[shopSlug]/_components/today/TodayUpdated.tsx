import { LiveRefresh } from "@/components/LiveRefresh";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **When this page last read the day** (fifth loop, item 8). The desk leaves
 * Today open all morning; `LiveRefresh` re-reads it on focus and once a minute,
 * and this line is the server's clock at that read, so a stale page says so.
 */
export function TodayUpdated({ t, time }: { t: StaffTranslator; time: string }) {
  return (
    <>
      <p className="mt-1 text-xs text-muted print:hidden" data-testid="today-updated">
        {t("shopHome.updatedAt", { time })}
      </p>
      <LiveRefresh />
    </>
  );
}
