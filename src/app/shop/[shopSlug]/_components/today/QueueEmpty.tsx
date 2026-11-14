import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** The queue's good-news moment when no work remains. */
export function QueueEmpty({ t, shopSlug }: { t: StaffTranslator; shopSlug: string }) {
  return (
    <EmptyState
      titleId="queue-heading"
      title={t("today.todayQueue.emptyHeading")}
      body={t("today.todayQueue.emptyBody")}
      action={
        <Link
          href={`/shop/${shopSlug}/schedule/board`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("today.todayQueue.emptyAction")}
        </Link>
      }
    />
  );
}
