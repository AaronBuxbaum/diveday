import { randomUUID } from "node:crypto";
import {
  ChoiceFieldset,
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FieldGrid,
} from "@/components/ui/form";
import { ITEM_TITLE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { getBlowoutPage } from "@/db/blowouts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { mailtoHref, telHref } from "@/lib/contact-links";
import { formatDateTimeTz } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { publicRecoveryActivityRequestPath } from "@/lib/public-routes";
import {
  createClassroomActivityAction,
  transitionClassroomActivityAction,
} from "../../blowout-actions";
import { ClassroomActivityForm } from "./ClassroomActivityForm";

type Page = NonNullable<Awaited<ReturnType<typeof getBlowoutPage>>>;
export function ClassroomRecovery({
  page,
  shopSlug,
  tripId,
  locale,
  timezone,
  dateRequestsEnabled,
  contactEmail,
  contactPhone,
  t,
}: {
  page: Pick<Page, "classroomActivities" | "classroomCoordinators" | "blowout">;
  shopSlug: string;
  tripId: string;
  locale: string;
  timezone: string;
  dateRequestsEnabled: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  t: StaffTranslator;
}) {
  const publicOrigin = publicAppUrl();
  const action = transitionClassroomActivityAction.bind(null, shopSlug, tripId);
  const form = (
    activity: Page["classroomActivities"][number],
    kind: string,
    label: string,
    children?: React.ReactNode,
    danger = false,
  ) => (
    <ClassroomActivityForm
      action={action}
      attemptId={randomUUID()}
      label={label}
      pendingLabel={t("words.busy.saving")}
      retryLabel={t("blowout.classroom.uncertain")}
      danger={danger}
    >
      <input type="hidden" name="activityId" value={activity.id} />
      <input type="hidden" name="revision" value={activity.revision} />
      <input type="hidden" name="kind" value={kind} />
      {children}
    </ClassroomActivityForm>
  );
  return (
    <section
      className="mt-6 rounded-panel border border-border p-4 sm:p-6"
      aria-labelledby="classroom-heading"
    >
      <h2 id="classroom-heading" className={SECTION_TITLE_CLASS}>
        {t("blowout.classroom.heading")}
      </h2>
      <p className="mt-2 text-base text-muted">{t("blowout.classroom.boundary")}</p>
      {page.classroomActivities.map((activity) => (
        <article key={activity.id} className="mt-5 border-t border-border pt-4">
          <h3 className={`break-words ${ITEM_TITLE_CLASS}`}>{activity.title}</h3>
          <div className="mt-2 space-y-1 break-words text-base">
            <p>
              {formatDateTimeTz(activity.startsAt, locale, timezone)} –{" "}
              {formatDateTimeTz(activity.endsAt, locale, timezone)}
            </p>
            <p>{activity.location}</p>
            <p>
              {t("blowout.classroom.coordinatorNamed", { name: activity.coordinatorName ?? "—" })}
            </p>
            <p>
              {activity.status === "cancelled"
                ? t("blowout.classroom.cancelled")
                : t("blowout.classroom.places", {
                    count: activity.confirmed,
                    capacity: activity.capacity,
                  })}
            </p>
          </div>
          {activity.conflicts.length > 0 && activity.status === "scheduled" ? (
            <p className="mt-2 text-base text-warning">{t("blowout.classroom.conflict")}</p>
          ) : null}
          {activity.status === "scheduled" ? (
            <details className="mt-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-primary">
                {t("blowout.classroom.manage")}
              </summary>
              {form(
                activity,
                "capacity",
                t("blowout.classroom.changeCapacity"),
                <Field label={t("blowout.classroom.capacity")}>
                  <input
                    name="capacity"
                    type="number"
                    min={Math.max(1, activity.confirmed)}
                    max={500}
                    required
                    defaultValue={activity.capacity}
                    className={controlClass}
                  />
                </Field>,
              )}
              <details className="mt-4 border-t border-border pt-2">
                <summary className="flex min-h-11 cursor-pointer items-center text-danger">
                  {t("blowout.classroom.cancel")}
                </summary>
                <p className="text-base text-muted">{t("blowout.classroom.cancelConsequence")}</p>
                {form(activity, "cancel_activity", t("blowout.classroom.cancel"), undefined, true)}
              </details>
            </details>
          ) : null}
          <details className="mt-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-primary">
              {t("blowout.classroom.divers")}
            </summary>
            <ul className="divide-y divide-border">
              {page.blowout?.divers.map((diver) => {
                const offer = activity.offers.find((row) => row.blowoutDiverId === diver.id);
                const allocation = activity.participants.find(
                  (row) => row.participant.blowoutDiverId === diver.id,
                );
                const confirmed =
                  activity.status === "scheduled" && allocation?.participant.status === "confirmed";
                const facts = offer?.snapshot;
                const replyPath =
                  publicOrigin &&
                  dateRequestsEnabled &&
                  activity.status === "scheduled" &&
                  activity.startsAt > nowDate()
                    ? `${publicOrigin}${publicRecoveryActivityRequestPath(shopSlug, activity.id)}`
                    : contactEmail
                      ? mailtoHref(contactEmail)
                      : contactPhone
                        ? telHref(contactPhone)
                        : null;
                return (
                  <li key={diver.id} className="py-4 text-base">
                    <p className="break-words font-medium">{diver.fullName}</p>
                    <p className="mt-1 text-muted">
                      {confirmed
                        ? allocation?.available
                          ? t("blowout.classroom.confirmed")
                          : t("blowout.classroom.anonymousHold")
                        : allocation
                          ? t("blowout.classroom.placeCancelled")
                          : t("blowout.classroom.noPlace")}
                    </p>
                    {offer && facts ? (
                      <>
                        <p className="mt-2 font-medium">{t("blowout.classroom.prepared")}</p>
                        <section
                          className="mt-2 select-text break-words rounded-panel bg-surface-sunken p-3"
                          aria-label={t("blowout.classroom.offerCopy")}
                        >
                          <p>
                            {t("blowout.classroom.offer", {
                              title: facts.title,
                              start: formatDateTimeTz(new Date(facts.startsAt), locale, timezone),
                              end: formatDateTimeTz(new Date(facts.endsAt), locale, timezone),
                              location: facts.location,
                            })}
                          </p>
                          {replyPath ? (
                            <a
                              href={replyPath}
                              className="mt-2 inline-flex min-h-11 items-center break-all text-primary"
                            >
                              {replyPath}
                            </a>
                          ) : (
                            <p className="mt-2">{t("blowout.classroom.manualContact")}</p>
                          )}
                        </section>
                      </>
                    ) : diver.canRecordRecovery && activity.status === "scheduled" ? (
                      form(
                        activity,
                        "offer",
                        t("blowout.classroom.prepare"),
                        <input type="hidden" name="blowoutDiverId" value={diver.id} />,
                      )
                    ) : null}
                    {(diver.canRecordRecovery || confirmed) && activity.status === "scheduled"
                      ? form(
                          activity,
                          confirmed ? "cancel_place" : "confirm",
                          confirmed
                            ? t("blowout.classroom.cancelPlace")
                            : t("blowout.classroom.confirm"),
                          <>
                            <input type="hidden" name="blowoutDiverId" value={diver.id} />
                            <input
                              type="hidden"
                              name="participantRevision"
                              value={allocation?.participant.revision ?? 0}
                            />
                          </>,
                        )
                      : null}
                  </li>
                );
              })}
            </ul>
          </details>
        </article>
      ))}
      <details className="mt-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-primary">
          {t("blowout.classroom.add")}
        </summary>
        <ClassroomActivityForm
          action={createClassroomActivityAction.bind(null, shopSlug, tripId)}
          attemptId={randomUUID()}
          label={t("blowout.classroom.create")}
          pendingLabel={t("words.busy.saving")}
          retryLabel={t("blowout.classroom.uncertain")}
          resetOnSuccess
        >
          <Field label={t("blowout.classroom.title")}>
            <input name="title" required maxLength={120} className={controlClass} />
          </Field>
          <p className="text-base text-muted">{t("blowout.classroom.timezone", { timezone })}</p>
          <FieldGrid columns={2}>
            <Field label={t("blowout.classroom.date")}>
              <DateField name="date" type="date" required />
            </Field>
            <Field label={t("blowout.classroom.start")}>
              <DateField name="startTime" type="time" required />
            </Field>
            <Field label={t("blowout.classroom.endDate")}>
              <DateField name="endDate" type="date" required />
            </Field>
            <Field label={t("blowout.classroom.end")}>
              <DateField name="endTime" type="time" required />
            </Field>
          </FieldGrid>
          <Field label={t("blowout.classroom.location")}>
            <input name="location" required maxLength={300} className={controlClass} />
          </Field>
          <FieldGrid columns={2}>
            <Field
              label={t("blowout.classroom.capacity")}
              hint={t("blowout.classroom.capacityHint")}
            >
              <input
                name="capacity"
                type="number"
                min={1}
                max={500}
                required
                className={controlClass}
              />
            </Field>
            <Field label={t("blowout.classroom.coordinator")}>
              <select name="coordinatorPersonId" required className={controlClass} defaultValue="">
                <option value="">{t("blowout.classroom.chooseCoordinator")}</option>
                {page.classroomCoordinators.map(({ person }) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
          <ChoiceFieldset legend={t("blowout.classroom.arrangements")}>
            <ChoiceRow name="arrangementsConfirmed" type="checkbox" required>
              <span>{t("blowout.classroom.attest")}</span>
            </ChoiceRow>
          </ChoiceFieldset>
        </ClassroomActivityForm>
      </details>
    </section>
  );
}
