import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { listCrewAssignmentRequests, listCrewAvailabilityBlocks } from "@/db/crew-requests";
import type { staffCredentials } from "@/db/schema";
import { listStaffCredentials } from "@/db/staff-credentials";
import { getStaffingView } from "@/db/staffing";
import { listStaff } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { calendarDateInTimezone, formatCalendarDate, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatCalendarDateRange } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, noticeRole, shopPath } from "@/lib/staff-notices";
import { staffWeek } from "@/lib/staffing-week";
import { resolveWeekStart, shiftWeek, WEEK_PARAM, weekStartOf } from "@/lib/week-board";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";
import {
  type CredentialRow,
  type RenewalState,
  StaffCredentials,
} from "./_components/StaffCredentials";
import { type GapWords, StaffingWeek } from "./_components/StaffingWeek";
import {
  createShiftAction,
  decideCrewRequestAction,
  deleteAwayAction,
  deleteShiftAction,
  deleteStaffCredentialAction,
  requestCrewAction,
  reviewStaffCredentialAction,
  saveAwayAction,
  saveStaffCredentialAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Staffing — DiveDay" };

/**
 * A notice query param maps to a message key, never to a sentence — the words
 * come from the staff bundle at render time (docs ADR
 * 20260730-staff-copy-localization). Typing the value as `StaffMessageKey`
 * makes a stale key a compile error rather than a rendered key on screen.
 */
const notices: Record<string, { tone: "success" | "danger" | "warning"; key: StaffMessageKey }> = {
  "shift-saved": { tone: "success", key: "staffing.notice.shiftSaved" },
  "shift-deleted": { tone: "success", key: "staffing.notice.shiftDeleted" },
  overlap: { tone: "danger", key: "staffing.notice.overlap" },
  "staff-not-found": { tone: "danger", key: "staffing.notice.staffNotFound" },
  invalid: { tone: "danger", key: "staffing.notice.invalid" },
  "not-authorized": { tone: "danger", key: "staffing.notice.notAuthorized" },
  "credential-saved": { tone: "success", key: "staffing.notice.credentialSaved" },
  "credential-reviewed": { tone: "success", key: "staffing.notice.credentialReviewed" },
  "credential-deleted": { tone: "success", key: "staffing.notice.credentialDeleted" },
  "credential-invalid": { tone: "danger", key: "staffing.notice.credentialInvalid" },

  // The crew's own acts and the owner's answer (issue #1235). The refusal
  // codes are the domain layer's own, in its casing — `noticeUrl` normalises
  // them to the kebab spelling this map holds.
  "away-saved": { tone: "success", key: "staffing.notice.awaySaved" },
  "away-deleted": { tone: "success", key: "staffing.notice.awayDeleted" },
  "request-sent": { tone: "success", key: "staffing.notice.requestSent" },
  "request-approved": { tone: "success", key: "staffing.notice.requestApproved" },
  // Loud on purpose: a shop that believes it has crewed a departure it has not
  // is the failure worth interrupting for.
  "request-approved-not-assigned": {
    tone: "warning",
    key: "staffing.notice.requestApprovedNotAssigned",
  },
  "request-declined": { tone: "success", key: "staffing.notice.requestDeclined" },
  "not-allowed": { tone: "danger", key: "staffing.notice.notAllowed" },
  "person-not-found": { tone: "danger", key: "staffing.notice.personNotFound" },
  "trip-not-found": { tone: "danger", key: "staffing.notice.tripNotFound" },
  "request-not-found": { tone: "danger", key: "staffing.notice.requestNotFound" },
  "invalid-range": { tone: "danger", key: "staffing.notice.invalidRange" },
};

/**
 * Everything the Add-a-shift door can answer for itself. Its outcome belongs
 * in its own action row rather than in a banner under the `<h1>` — and because
 * the door is now a disclosure, the same set decides whether it opens on
 * arrival: a refusal that closed the form it came from would leave the reader
 * a red banner and nothing to correct.
 *
 * `shift-deleted` is not one of them: it comes from a Remove inside the week
 * above, so it keeps the banner, which is the nearer of the two.
 * `not-authorized` stays there too — a staffer without the right never sees
 * the door at all.
 */
const ADD_SHIFT_NOTICES = new Set(["shift-saved", "overlap", "staff-not-found", "invalid"]);

const CREDENTIAL_KIND_KEYS: Record<
  (typeof staffCredentials.kind.enumValues)[number],
  StaffMessageKey
> = {
  instructor_rating: "staffing.credentials.kinds.instructor_rating",
  divemaster_rating: "staffing.credentials.kinds.divemaster_rating",
  liability_insurance: "staffing.credentials.kinds.liability_insurance",
  first_aid_cpr: "staffing.credentials.kinds.first_aid_cpr",
  oxygen_provider: "staffing.credentials.kinds.oxygen_provider",
  captains_licence: "staffing.credentials.kinds.captains_licence",
  other: "staffing.credentials.kinds.other",
};

/**
 * A person's roles, in the words Team already gave them. The roster used to
 * render the raw enum values (`instructor · captain`) beside three derived
 * capability pills — English leaking out of the domain layer onto a Spanish
 * reader's screen, and the same fact stated twice. These are the seven labels
 * the Team page shows, single-sourced.
 */
const ROLE_LABEL_KEYS: Record<Role, StaffMessageKey> = {
  owner: "settings.team.roleLabels.owner",
  manager: "settings.team.roleLabels.manager",
  instructor: "settings.team.roleLabels.instructor",
  divemaster: "settings.team.roleLabels.divemaster",
  captain: "settings.team.roleLabels.captain",
  crew: "settings.team.roleLabels.crew",
  diver: "settings.team.roleLabels.diver",
};

/** How far ahead a renewal counts as due soon. H-59: a word, never a gate. */
const RENEWAL_WINDOW_DAYS = 30;

export default async function StaffingPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  /**
   * `?week=` only. The old `?from=`/`?to=` window is gone — the week *is* the
   * window now — and the two are ignored rather than refused, so an old
   * bookmark lands on this week instead of nowhere (`FlashParams` then clears
   * them out of the address bar).
   */
  searchParams: Promise<{ week?: string; notice?: string }>;
}) {
  const { shopSlug } = await params;
  const query = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  // Negotiated from the request, falling back to the shop's default — a staff
  // member reads dates and copy in their own language, not the shop row's.
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // Through the clock, not `new Date()`, and through the *shop's* zone, not
  // the host's: this one value decides which week the page opens on, which
  // column is Today, and which days are already behind. A raw wall-clock read
  // here left the one staff surface that ignored DIVEDAY_CLOCK — the seeded
  // shifts sit at the frozen instant while the window opened on the real
  // today, which is both an unstable visual baseline and an e2e fixture that
  // drifts out from under itself. In production `nowDate()` is the native
  // call, unchanged.
  const now = nowDate();
  const today = calendarDateInTimezone(now, shop.timezone);
  // The same `?week=` grammar the schedule board pages by, over the same dates
  // (`src/lib/week-board.ts`; ADR 20260827-clearwater-surface-language,
  // decision 5). Total by construction: a malformed or missing value lands on
  // the week the shop is in rather than refusing the page.
  const weekStart = resolveWeekStart(query[WEEK_PARAM], today);
  const weekEnd = shiftCalendarDate(weekStart, 6);
  // **What the Add-a-shift form opens on: today, when the week on screen
  // contains it.** Defaulting to `weekStart` unconditionally put a Friday
  // afternoon's last-minute crew change — the busy-dock case this page exists
  // for — on Monday, silently: `createStaffShift` validates only that a shift
  // ends after it starts, so nothing refused the date, and the trip page then
  // went on reporting that crew member as not on a shift for the coverage
  // warning the manager believed they had just cleared. Paging to another week
  // still opens on that week's Monday, which is the only honest answer there.
  // Calendar dates are ISO `YYYY-MM-DD`, so the ordering is the string's.
  const defaultShiftDate = today >= weekStart && today <= weekEnd ? today : weekStart;
  // The week's boundaries are **shop-local midnights**, turned into instants
  // here. On a UTC server the naive reading starts the week four or five hours
  // early and drags the previous Sunday evening's shifts into it.
  const fromWall = parseWallTime(weekStart, "00:00");
  const toWall = parseWallTime(shiftCalendarDate(weekStart, 7), "00:00");
  if (!fromWall || !toWall) redirect(shopPath(shopSlug, "staffing"));
  const [view, staff, credentials, blocks] = await Promise.all([
    getStaffingView(
      db,
      shop.id,
      wallTimeToUtc(fromWall, shop.timezone),
      wallTimeToUtc(toWall, shop.timezone),
      // The shop's own supervision target, so this week measures a departure
      // exactly as Today's queue and the trip page do.
      { diversPerDivemaster: shop.diversPerDivemaster },
    ),
    listStaff(db, shop.id),
    listStaffCredentials(db, shop.id),
    // The whole week's blackouts, whoever's: a person's own draw as quiet
    // chips in their row, and everybody's are needed to warn on an assignment.
    listCrewAvailabilityBlocks(db, shop.id, { from: weekStart, to: weekEnd }),
  ]);
  // Requests hang off the gaps, so they are asked for after the view knows
  // which departures are short — one query, over the ids that can carry one.
  const crewRequests = await listCrewAssignmentRequests(
    db,
    shop.id,
    view.gapTrips.map((trip) => trip.tripId),
  );
  const canManage = await canPersonManageStaffAccounts(db, shop.id, session.user.personId);
  const notice = noticeFromParam(query.notice, notices);
  const onShiftForm =
    canManage && query.notice !== undefined && ADD_SHIFT_NOTICES.has(query.notice);
  const shiftStatus = onShiftForm ? notice : undefined;
  const pageNotice = onShiftForm ? undefined : notice;

  const week = staffWeek({
    blocks,
    requests: crewRequests,
    // Who is reading. `isCrew` is deliberately every staff role: a captain
    // asking to run Saturday's boat is the ordinary case, and narrowing it to
    // instructors would rebuild the "only the owner writes here" shape this
    // slice exists to open (ADR 20260902-crew-requests-and-blackouts).
    viewer: { personId: session.user.personId, isCrew: true },
    now,
    people: view.staff.map((member) => ({
      personId: member.person.id,
      name: member.person.fullName,
      roles: member.roles
        .map((role) => ROLE_LABEL_KEYS[role as Role])
        .filter((key): key is StaffMessageKey => Boolean(key))
        .map((key) => t(key)),
      shifts: member.shifts.map((shift) => ({
        id: shift.id,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        note: shift.note,
      })),
      crewingTrips: member.crewingTrips,
    })),
    gaps: view.gapTrips,
    weekStart,
    timeZone: shop.timezone,
    today,
  });

  // One vocabulary, not two: every word here already belongs to a surface that
  // can fix the gap — Today's chip labels for the shop's own target, the trip
  // pulse's for the agency training ratio. The staffing week owns no crew
  // vocabulary of its own (ADR 20260806-staffing-is-the-shift-roster).
  //
  // All five now read at chip length. The two pulse keys were whole sentences
  // written for the trip page, where a full-width row has all the space a
  // sentence wants; here the day column is about 135px and "This course
  // session has no instructor yet" took four lines beside "No crew" (#1125).
  //
  // `uncrewed_course` is the one that has to say two things in that column
  // (issue #1338): a course session with nobody in the water needs an
  // instructor *and* has nobody supervising, and a chip saying only the second
  // sends a manager to phone any divemaster, who cannot close the first.
  const gapWords: GapWords = {
    no_instructor: t("trips.pulse.needsInstructor"),
    over_ratio: t("trips.pulse.overRatio"),
    uncrewed_course: t("shared.today.actionKind.uncrewedCourse"),
    uncrewed_departure: t("shared.today.actionKind.uncrewedDeparture"),
    crew_below_target: t("shared.today.actionKind.crewBelowTarget"),
  };

  const myBlocks = blocks.filter((block) => block.personId === session.user.personId);
  const staffingPath = shopPath(shopSlug, "staffing");
  // **Every act carries the week it was performed in.** The page grew a week
  // dimension and the actions did not, so building next week's roster — the
  // ordinary Sunday-evening job — meant being thrown back to this week after
  // every save, with the shift just added nowhere on screen and the add form's
  // date reset under it. Bound rather than a hidden field in six forms: the
  // week is the page's own reading of the URL, not something a submitter gets
  // to choose, and one binding cannot drift from another.
  const createShift = createShiftAction.bind(null, weekStart);
  const deleteShift = deleteShiftAction.bind(null, weekStart);
  // The crew's own two acts, and the owner's answer (issue #1235). Bound to
  // the week for the same reason every other act here is: a save that threw
  // the reader back to this week made building next week's roster impossible.
  const requestCrew = requestCrewAction.bind(null, weekStart);
  const decideRequest = decideCrewRequestAction.bind(null, weekStart);
  const saveAway = saveAwayAction.bind(null, weekStart);
  const deleteAway = deleteAwayAction.bind(null, weekStart);
  const saveCredential = saveStaffCredentialAction.bind(null, weekStart);
  const reviewCredential = reviewStaffCredentialAction.bind(null, weekStart);
  const deleteCredential = deleteStaffCredentialAction.bind(null, weekStart);
  const dueSoonThrough = shiftCalendarDate(today, RENEWAL_WINDOW_DAYS);
  const credentialRows: CredentialRow[] = credentials.map(({ credential, person }) => {
    const renewal: RenewalState = !credential.renewsAt
      ? "not-recorded"
      : credential.renewsAt < today
        ? "overdue"
        : credential.renewsAt <= dueSoonThrough
          ? "due-soon"
          : "current";
    return {
      id: credential.id,
      title: `${person.fullName} · ${credential.name}`,
      detail: [
        credential.status === "verified"
          ? t("staffing.credentials.verified")
          : t("staffing.credentials.pending"),
        t(CREDENTIAL_KIND_KEYS[credential.kind]),
        credential.issuingBody,
      ]
        .filter(Boolean)
        .join(" · "),
      // The word is what carries the state; the ink only seconds it. A
      // credential whose renewal is comfortably ahead says the date and
      // nothing more, and one with no renewal recorded says nothing at all.
      renewalWord:
        renewal === "overdue"
          ? t("staffing.credentials.overdue")
          : renewal === "due-soon"
            ? t("staffing.credentials.dueSoon")
            : credential.renewsAt
              ? t("staffing.credentials.renews", {
                  date: formatCalendarDate(credential.renewsAt, locale),
                })
              : null,
      renewal,
      reviewed: credential.status === "verified",
      reviewLabel:
        credential.status === "verified"
          ? t("staffing.credentials.markPending")
          : t("staffing.credentials.markVerified"),
    };
  });

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* `week` is a reading of the page and stays in the URL; the rest is
          one-shot chrome, including the retired `from`/`to` an old bookmark
          may still carry. */}
      <FlashParams params={["from", "to", "notice"]} />
      <ShopPageHeader eyebrow={t("staffing.eyebrow")} title={t("staffing.title")} />

      {pageNotice ? (
        <div className="mb-6">
          <ShopNotice tone={pageNotice.tone} role={noticeRole(pageNotice.tone)}>
            {t(pageNotice.key)}
          </ShopNotice>
        </div>
      ) : null}

      {/* Nobody on the roster used to render as an empty grid — a heading, a
          date range, and then nothing at all, which reads as a page that
          failed to load. Who can fix it decides what it says: a manager gets
          the door to Team, everyone else gets the honest "ask an owner". The
          week and both doors stay off the page until there is a team, because
          a shift needs somebody to give it to. */}
      {view.staff.length === 0 ? (
        <EmptyState
          titleAs="h2"
          title={t("staffing.working.rosterEmptyHeading")}
          body={
            canManage
              ? t("staffing.working.rosterEmptyManagerBody")
              : t("staffing.working.rosterEmptyBody")
          }
          action={
            canManage ? (
              <Link
                href={shopPath(shopSlug, "settings", "team")}
                className={buttonClass({ className: "mt-4" })}
              >
                {t("staffing.working.rosterEmptyAction")}
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <StaffingWeek
            week={week}
            gapWords={gapWords}
            locale={locale}
            timeZone={shop.timezone}
            shopSlug={shopSlug}
            canManage={canManage}
            canDecide={canManage}
            deleteShiftAction={deleteShift}
            requestAction={requestCrew}
            decideRequestAction={decideRequest}
            links={{
              rangeLabel: formatCalendarDateRange(weekStart, weekEnd, locale),
              previousHref: `${staffingPath}?${WEEK_PARAM}=${shiftWeek(weekStart, -1)}`,
              nextHref: `${staffingPath}?${WEEK_PARAM}=${shiftWeek(weekStart, 1)}`,
              // Absent while it would only reload the week already on screen.
              thisWeekHref: weekStart === weekStartOf(today) ? null : staffingPath,
            }}
            words={{
              ariaLabel: t("staffing.week.ariaLabel"),
              previous: t("staffing.week.previous"),
              next: t("staffing.week.next"),
              thisWeek: t("staffing.week.thisWeek"),
              today: t("staffing.week.today"),
              person: t("staffing.week.person"),
              needsCrew: t("staffing.week.needsCrew"),
              assign: t("staffing.week.assign"),
              // **`t.raw`, not `t`** — both of these name an argument that only
              // `StaffingWeek` can supply (the departure's title, the person and
              // the day), so they cross as templates and `fill()` completes them
              // on the client. `t()` would try to *format* them here, with the
              // argument by definition absent (src/i18n/fill.ts).
              assignAria: t.raw("staffing.week.assignAria"),
              crewing: t("staffing.week.crewing"),
              remove: t("staffing.working.remove"),
              removing: t("staffing.working.removing"),
              shiftAria: t.raw("staffing.week.shiftAria"),
              empty: t("staffing.week.empty"),
              away: t("staffing.week.away"),
              awayConflict: t.raw("staffing.week.awayConflict"),
              request: t("staffing.week.request"),
              requestAria: t.raw("staffing.week.requestAria"),
              requesting: t("staffing.week.requesting"),
              requested: t.raw("staffing.week.requested"),
              approve: t("staffing.week.approve"),
              decline: t("staffing.week.decline"),
              deciding: t("staffing.week.deciding"),
              requestApproved: t("staffing.week.requestApproved"),
              requestDeclined: t("staffing.week.requestDeclined"),
            }}
          />

          {canManage ? (
            <AddDoor id="add-shift" label={t("staffing.addShift.heading")} open={onShiftForm}>
              <FieldGrid as="form" action={createShift} columns={2}>
                <Field label={t("staffing.addShift.person")}>
                  <select name="personId" required className={controlClass}>
                    <option value="">{t("staffing.addShift.choosePerson")}</option>
                    {staff.map((member) => (
                      <option key={member.person.id} value={member.person.id}>
                        {member.person.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("staffing.addShift.date")}>
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={defaultShiftDate}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("staffing.addShift.starts")}>
                  <input
                    name="startTime"
                    type="time"
                    required
                    defaultValue="07:00"
                    className={controlClass}
                  />
                </Field>
                <Field label={t("staffing.addShift.ends")}>
                  <input
                    name="endTime"
                    type="time"
                    required
                    defaultValue="15:00"
                    className={controlClass}
                  />
                </Field>
                <Field label={t("staffing.addShift.note")} hint={t("staffing.addShift.noteHint")}>
                  <input
                    name="note"
                    maxLength={120}
                    className={controlClass}
                    placeholder={t("staffing.addShift.notePlaceholder")}
                  />
                </Field>
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("staffing.addShift.saving")}
                    className={buttonClass()}
                  >
                    {t("staffing.addShift.submit")}
                  </SubmitButton>
                  <FormStatus tone={shiftStatus?.tone}>
                    {shiftStatus ? t(shiftStatus.key) : undefined}
                  </FormStatus>
                </FieldActions>
              </FieldGrid>
            </AddDoor>
          ) : null}

          {/* **The crew member's own door** (issue #1235, ADR
              20260902-crew-requests-and-blackouts). Every other write on this
              page is behind `canManage`; this one is not, and that is the whole
              point of the slice. A manager's `<select>` lets them record a
              range for somebody who phoned on a Sunday; everyone else writes
              their own row and the domain layer refuses anything else. */}
          <AddDoor id="add-away" label={t("staffing.away.heading")}>
            <FieldGrid as="form" action={saveAway} columns={2}>
              {canManage ? (
                <Field label={t("staffing.away.person")}>
                  <select
                    name="personId"
                    required
                    defaultValue={session.user.personId}
                    className={controlClass}
                  >
                    {staff.map((member) => (
                      <option key={member.person.id} value={member.person.id}>
                        {member.person.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                // Never a form field for a crew member: the person is the
                // session's own, and the domain layer checks it again anyway.
                <input type="hidden" name="personId" value={session.user.personId} />
              )}
              <Field label={t("staffing.away.from")}>
                <input
                  name="startsOn"
                  type="date"
                  required
                  defaultValue={defaultShiftDate}
                  className={controlClass}
                />
              </Field>
              <Field label={t("staffing.away.to")}>
                <input
                  name="endsOn"
                  type="date"
                  required
                  defaultValue={defaultShiftDate}
                  className={controlClass}
                />
              </Field>
              <Field label={t("staffing.away.note")}>
                <input
                  name="note"
                  maxLength={120}
                  className={controlClass}
                  placeholder={t("staffing.away.notePlaceholder")}
                />
              </Field>
              <FieldActions>
                <SubmitButton pendingLabel={t("staffing.away.saving")} className={buttonClass()}>
                  {t("staffing.away.save")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
            {/* Their own rows for the week on screen, each with its one act.
                Somebody else's are visible on the grid above as quiet chips
                and are not removable here — the row belongs to its person. */}
            {myBlocks.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-2">
                {myBlocks.map((block) => (
                  <li key={block.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      {formatCalendarDateRange(block.startsOn, block.endsOn, locale)}
                      {block.note ? ` · ${block.note}` : ""}
                    </span>
                    <form action={deleteAway}>
                      <input type="hidden" name="blockId" value={block.id} />
                      <SubmitButton
                        pendingLabel={t("staffing.away.removing")}
                        className={buttonClass({ variant: "ghost", size: "sm" })}
                      >
                        {t("staffing.away.remove")}
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}
          </AddDoor>

          {/* Owner/manager work, as it was before this slice — the
              recomposition moved the furniture, not who may see it. The group
              always carries its door, so a shop that has recorded nothing gets
              a way in rather than the bare "nothing recorded yet" line that
              used to stand in for a group with no members. */}
          {canManage ? (
            <StaffCredentials
              label={t("staffing.credentials.heading")}
              rows={credentialRows}
              words={{
                saving: t("staffing.credentials.saving"),
                remove: t("staffing.credentials.remove"),
                removing: t("staffing.credentials.removing"),
              }}
              reviewAction={reviewCredential}
              deleteAction={deleteCredential}
              door={
                <AddDoor id="add-credential" as="li" label={t("staffing.credentials.add")}>
                  <FieldGrid as="form" action={saveCredential} columns={2}>
                    <Field label={t("staffing.credentials.person")}>
                      <select name="personId" required className={controlClass}>
                        <option value="">{t("staffing.credentials.choosePerson")}</option>
                        {staff.map(({ person }) => (
                          <option key={person.id} value={person.id}>
                            {person.fullName}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("staffing.credentials.kind")}>
                      <select name="kind" required className={controlClass}>
                        {Object.entries(CREDENTIAL_KIND_KEYS).map(([kind, key]) => (
                          <option key={kind} value={kind}>
                            {t(key)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("staffing.credentials.name")}>
                      <input name="name" required maxLength={160} className={controlClass} />
                    </Field>
                    <Field label={t("staffing.credentials.issuer")}>
                      <input name="issuingBody" maxLength={160} className={controlClass} />
                    </Field>
                    <Field label={t("staffing.credentials.identifier")}>
                      <input name="identifier" maxLength={120} className={controlClass} />
                    </Field>
                    <Field label={t("staffing.credentials.issuedAt")}>
                      <input name="issuedAt" type="date" className={controlClass} />
                    </Field>
                    <Field label={t("staffing.credentials.renewsAt")}>
                      <input name="renewsAt" type="date" className={controlClass} />
                    </Field>
                    <FieldActions>
                      <SubmitButton
                        pendingLabel={t("staffing.credentials.saving")}
                        className={buttonClass()}
                      >
                        {t("staffing.credentials.add")}
                      </SubmitButton>
                    </FieldActions>
                  </FieldGrid>
                </AddDoor>
              }
            />
          ) : null}
        </>
      )}
    </main>
  );
}

/**
 * The tail row that *is* a form's door — the shape both of this page's add
 * forms wear (ADR 20260827-the-shops-shelves, decision 3: "the two add-forms
 * become one '+ Add a shift' door").
 *
 * A native `<details>` on a hairline row, so the form opens in place under the
 * ledger it belongs to and a JS failure still leaves it one tap away. It sits
 * at the tail rather than in the page header — where the artboard draws it —
 * for a mechanical reason: a disclosure renders its body inside itself, and a
 * summary in the header would open a two-column form into a right-aligned
 * action slot. The `+` is the affordance; a caret beside it would be the same
 * promise made twice.
 */
function AddDoor({
  id,
  label,
  open,
  as: Tag = "div",
  children,
}: {
  id: string;
  label: string;
  /** Server-decided: a refusal reopens the form it came from. */
  open?: boolean;
  /** `li` when the door is the tail row of a ledger's own `<ul>`. */
  as?: "li" | "div";
  children: React.ReactNode;
}) {
  return (
    // The hairline belongs to the row, not to the `<details>`, so `last:`
    // closes a ledger whose final member is this door.
    <Tag className="list-none border-t border-border last:border-b">
      <AutoOpenDetails id={id} openOnHash={id} open={open} className="group/add scroll-mt-8">
        <summary
          className={buttonClass({
            variant: "link",
            flush: true,
            className: "list-none select-none [&::-webkit-details-marker]:hidden",
          })}
        >
          {label}
        </summary>
        <div className="pt-1 pb-6">{children}</div>
      </AutoOpenDetails>
    </Tag>
  );
}
