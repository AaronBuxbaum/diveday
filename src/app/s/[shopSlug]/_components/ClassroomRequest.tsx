import { submitInquiryAction } from "@/app/actions/inquiry";
import { DateRequestForm } from "@/components/DateRequestForm";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { publicRecoveryActivity } from "@/features/trips/recovery-activities";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { dateRequestCopy } from "@/i18n/date-request-copy";
import { diverTranslator } from "@/i18n/messages";
import { formatDateTimeTz } from "@/lib/format";

export async function ClassroomRequest({
  shop,
  query,
  locale,
}: {
  shop: { id: string; slug: string; timezone: string; dateRequestsEnabled: boolean };
  query: { recoveryActivity?: string };
  locale: string;
}) {
  if (!query.recoveryActivity) return null;
  const activityId = query.recoveryActivity;
  const { id: shopId, slug: shopSlug, timezone, dateRequestsEnabled } = shop;
  const t = diverTranslator(locale);
  const activity = dateRequestsEnabled
    ? await publicRecoveryActivity(await getDb(), shopId, activityId)
    : null;
  if (!activity)
    return (
      <p className="my-6 text-base" id="classroom-request">
        {t("inquiry.classroom.unavailable")}
      </p>
    );
  const copy = {
    ...dateRequestCopy(t, "dive"),
    heading: t("inquiry.classroom.heading"),
    intro: t("inquiry.classroom.intro"),
    howManyDivers: t("inquiry.classroom.people"),
    send: t("inquiry.classroom.send"),
    sentBody: t("inquiry.classroom.sent"),
  };
  return (
    <section className="my-6 rounded-panel border border-border p-4 sm:p-6">
      <h2 className={`break-words ${SECTION_TITLE_CLASS}`}>{activity.title}</h2>
      <p className="mt-2 text-base">
        {formatDateTimeTz(activity.startsAt, locale, timezone)} –{" "}
        {formatDateTimeTz(activity.endsAt, locale, timezone)}
      </p>
      <p className="mt-1 break-words text-base">{activity.location}</p>
      <DiverIntlProvider
        locale={locale}
        timeZone={timezone}
        namespaces={["inquiry", "common", "course"]}
      >
        <DateRequestForm
          submitRequest={submitInquiryAction.bind(null, shopSlug, null)}
          sectionId="classroom-request"
          recoveryActivity={{ id: activity.id, title: activity.title }}
          contactEmail={null}
          contactPhone={null}
          copy={copy}
        />
      </DiverIntlProvider>
    </section>
  );
}
