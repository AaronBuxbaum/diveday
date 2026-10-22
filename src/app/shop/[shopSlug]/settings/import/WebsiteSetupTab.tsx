import type { AppDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { readWebsiteSetup } from "@/db/website-setup";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { WebsiteSetupPanel } from "./WebsiteSetupPanel";

/** The Website tab's reads, beside the page rather than in it. */
export async function WebsiteSetupTab({
  db,
  shop,
  t,
  locale,
  notice,
}: {
  db: AppDb;
  shop: { id: string; slug: string; timezone: string; currency: string };
  t: StaffTranslator;
  locale: string;
  notice?: string;
}) {
  const [setup, courses] = await Promise.all([
    readWebsiteSetup(db, shop.id),
    listActiveCourses(db, shop.id),
  ]);
  return (
    <div className="space-y-6">
      <WebsiteSetupPanel
        t={t}
        notice={notice}
        setup={setup}
        shop={shop}
        locale={locale}
        now={nowDate()}
        courseNames={new Map(courses.map((course) => [course.id, course.title]))}
      />
    </div>
  );
}
