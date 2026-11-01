import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import type { LadderStep } from "@/db/course-ladder";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { noticeFromParam } from "@/lib/staff-notices";

/** What an invite from the course ladder did (`inviteToCourseSessionAction`). */
const LADDER_NOTICES: Record<
  string,
  { key: StaffMessageKey; tone: "success" | "warning" | "danger" }
> = {
  "invite-sent": { key: "courses.ladder.notice.invite-sent", tone: "success" },
  "invite-opted-out": { key: "courses.ladder.notice.invite-opted-out", tone: "warning" },
  "invite-cooldown": { key: "courses.ladder.notice.invite-cooldown", tone: "warning" },
  "invite-unavailable": { key: "courses.ladder.notice.invite-unavailable", tone: "warning" },
  "invite-failed": { key: "courses.ladder.notice.invite-failed", tone: "danger" },
};

/** The `?notice=` an invite from the ladder came back with, above the roster. */
export function LadderNotice({ notice, t }: { notice?: string; t: StaffTranslator }) {
  const said = noticeFromParam(notice, LADDER_NOTICES);
  if (!said) return null;
  return (
    <ShopNotice tone={said.tone} className="mt-6">
      {t(said.key)}
    </ShopNotice>
  );
}

/**
 * **Who finished here and never took the next step** (fifth-loop ideas, item
 * 45). One line per course with a next step: how many did it in the last
 * twelve months and how many went on, then "See who" opening the names of
 * those who did not, each with an "Invite" to the next course's soonest
 * session (H-20261014-one-to-one-invite: one at a time, the 30-day cooldown). For the desk to call or
 * invite one by one; it sends nothing in bulk. Someone whose release waits on
 * a physician's referral says so and has no Invite: the desk calls instead
 * (dive-domain review N4).
 */
export function CourseLadder({
  steps,
  invite,
  locale,
  timeZone,
  t,
}: {
  steps: LadderStep[];
  invite: (formData: FormData) => void;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  if (steps.length === 0) return null;
  return (
    <section
      aria-labelledby="course-ladder-heading"
      className="mt-8 space-y-3"
      data-testid="course-ladder"
    >
      <h2 id="course-ladder-heading" className="font-semibold">
        {t("courses.ladder.heading")}
      </h2>
      <ul className="divide-y divide-border rounded-panel border border-border">
        {steps.map((step) => (
          <li key={step.course.id} className="space-y-1 px-4 py-3 text-sm">
            <p>
              {step.kind === "taster"
                ? t("courses.ladder.taster", {
                    count: step.count,
                    course: step.course.title,
                    wentOn: step.wentOn,
                    next: step.next.title,
                  })
                : t("courses.ladder.certified", {
                    count: step.stalled.length,
                    course: step.course.title,
                    next: step.next.title,
                  })}
            </p>
            <p className="text-muted tabular-nums">
              {step.nextSession
                ? t("courses.ladder.nextSession", {
                    next: step.next.title,
                    date: formatShortDate(step.nextSession.startsAt, locale, timeZone),
                    booked: step.nextSession.booked,
                    capacity: step.nextSession.capacity,
                  })
                : t("courses.ladder.noSession", { next: step.next.title })}
            </p>
            {step.stalled.length > 0 ? (
              <CompactDisclosureRow label={t("courses.ladder.seeWho")} bodyClassName="">
                <ul className="divide-y divide-border">
                  {step.stalled.map((person) => (
                    <li
                      key={person.personId}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
                    >
                      <span>
                        <span className="font-medium">{person.fullName}</span>
                        {person.medicalReferral ? (
                          <span className="ms-2 text-warning-strong">
                            {t("courses.ladder.referral")}
                          </span>
                        ) : null}
                      </span>
                      {step.nextSession && person.invitable && !person.medicalReferral ? (
                        <form action={invite}>
                          <input type="hidden" name="personId" value={person.personId} />
                          <input type="hidden" name="tripId" value={step.nextSession.tripId} />
                          <SubmitButton
                            pendingLabel={t("courses.ladder.inviting")}
                            ariaLabel={t("courses.ladder.inviteAria", {
                              name: person.fullName,
                              next: step.next.title,
                            })}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            {t("courses.ladder.invite")}
                          </SubmitButton>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CompactDisclosureRow>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
