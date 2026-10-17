import type { StaffTranslator } from "@/i18n/staff-messages";
import { publicSchedulePath } from "@/lib/public-routes";
import { FirstBookableCard } from "./FirstBookableCard";

/** The once-in-a-shop's-life share card, when the first departure lands on the board. */
export function TodayFirstBookable({
  shopSlug,
  created,
  seriesCount,
  publicScheduleUrl,
  t,
}: {
  shopSlug: string;
  created: string;
  seriesCount: number;
  publicScheduleUrl: string;
  t: StaffTranslator;
}) {
  return (
    <FirstBookableCard
      scheduleUrl={publicScheduleUrl}
      scheduleHref={publicSchedulePath(shopSlug)}
      copy={{
        heading: t("shopHome.firstBookable.heading"),
        body:
          seriesCount > 1
            ? t("shopHome.firstBookable.bodySeries", {
                title: created,
                count: seriesCount,
              })
            : t("shopHome.firstBookable.body", { title: created }),
        linkLabel: t("shopHome.firstBookable.linkLabel"),
        copy: t("shopHome.firstRun.scheduleCopy"),
        copied: t("shopHome.firstRun.scheduleCopied"),
        copyFailed: t("shopHome.firstRun.scheduleCopyFailed"),
        viewAsDiver: t("shopHome.firstBookable.viewAsDiver"),
      }}
    />
  );
}
