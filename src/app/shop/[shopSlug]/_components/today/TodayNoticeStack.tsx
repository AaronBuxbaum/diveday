import { ShopNotice } from "@/components/ShopPageHeader";
import { type StaffWords, sayWords } from "@/i18n/shared-sentences";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { type NoticeTone, noticeRole } from "@/lib/staff-notices";

/** The page's one notice surface: a visit rarely carries more than one, and they stack. */
export function TodayNoticeStack({
  created,
  seriesCount,
  firstBookableMoment,
  reset,
  email,
  authNoticeKey,
  eveningNotice,
  t,
}: {
  created?: string;
  seriesCount: number;
  firstBookableMoment: boolean;
  reset?: string;
  email?: string;
  authNoticeKey?: StaffMessageKey | StaffWords;
  eveningNotice?: { key: StaffMessageKey; tone: NoticeTone };
  t: StaffTranslator;
}) {
  return (
    <>
      {/* One notice surface. A visit rarely carries more than one of these;
          when it does, they read as one stack of arrivals rather than four
          competing banners. `mb-10` is the spine's own `gap-10`: the stack is
          one more block in that column, not closer to it (K-316). */}
      {(created && !firstBookableMoment) ||
      reset === "1" ||
      reset === "refused" ||
      email ||
      authNoticeKey ||
      eveningNotice ? (
        <div className="mb-10 flex flex-col gap-2">
          {created && !firstBookableMoment ? (
            <ShopNotice>
              {seriesCount > 1
                ? t("shopHome.createdNotice.series", { title: created, count: seriesCount })
                : t("shopHome.createdNotice.single", { title: created })}
            </ShopNotice>
          ) : null}
          {reset === "1" ? <ShopNotice tone="neutral">{t("shopHome.demoReset")}</ShopNotice> : null}
          {reset === "refused" ? (
            <ShopNotice tone="warning" role="status">
              {t("shopHome.demoResetRefused")}
            </ShopNotice>
          ) : null}
          {email ? (
            // A failed send must announce itself (noticeRole: danger → alert);
            // without a role this read as ambient status to screen readers.
            <ShopNotice
              tone={email === "sent" ? "success" : "danger"}
              role={noticeRole(email === "sent" ? "success" : "danger")}
            >
              {email === "sent" ? t("shopHome.emailResent") : t("shopHome.emailFailed")}
            </ShopNotice>
          ) : null}
          {authNoticeKey ? (
            <ShopNotice tone="warning" role="status">
              {sayWords(t, authNoticeKey)}
            </ShopNotice>
          ) : null}
          {eveningNotice ? (
            <ShopNotice tone={eveningNotice.tone} role={noticeRole(eveningNotice.tone)}>
              {sayWords(t, eveningNotice)}
            </ShopNotice>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
