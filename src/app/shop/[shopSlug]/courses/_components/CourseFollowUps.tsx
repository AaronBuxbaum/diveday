import { EmptyState } from "@/components/EmptyState";
import type { AppDb } from "@/db/client";
import { queryAll } from "@/db/query-helpers";
import { listCardsToProcess, listCardsToValidate } from "@/features/agency-processing";
import { getCourseLadder } from "@/features/course-ladder";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { inviteToCourseSessionAction, markCardProcessedFromCoursesAction } from "../actions";
import { CardsToProcess } from "./CardsToProcess";
import { CardsToValidate } from "./CardsToValidate";
import { CourseLadder } from "./CourseLadder";

export { LadderNotice } from "./CourseLadder";

/**
 * What the course roster's follow-up work is, under the list: the cards
 * on file that nobody has validated with their agency, the cards
 * issued here that nobody has sent to the agency yet (fifth-loop ideas, item
 * 46), then who finished a course here and never took the next step (item
 * 45). Each renders nothing when it has nothing to say.
 */
export async function CourseFollowUps({
  db,
  shop,
  locale,
  t,
}: {
  db: AppDb;
  shop: { id: string; slug: string; timezone: string };
  locale: string;
  t: StaffTranslator;
}) {
  const now = nowDate();
  const [ladder, cards, toValidate] = await queryAll(db, [
    () => getCourseLadder(db, shop.id, now, shop.timezone),
    () => listCardsToProcess(db, shop.id),
    () => listCardsToValidate(db, shop.id),
  ]);
  if (!ladder.length && !cards.length && !toValidate.length)
    return (
      <EmptyState title={t("courses.followUpEmpty.title")} body={t("courses.followUpEmpty.body")} />
    );
  return (
    <>
      <CardsToValidate
        cards={toValidate}
        shopSlug={shop.slug}
        locale={locale}
        timeZone={shop.timezone}
        t={t}
      />
      <CardsToProcess
        cards={cards}
        markProcessed={markCardProcessedFromCoursesAction.bind(null, shop.slug)}
        now={now}
        locale={locale}
        timeZone={shop.timezone}
        t={t}
      />
      <CourseLadder
        steps={ladder}
        invite={inviteToCourseSessionAction.bind(null, shop.slug)}
        locale={locale}
        timeZone={shop.timezone}
        t={t}
      />
    </>
  );
}
