import { EarnedMomentLine } from "@/components/EarnedMoment";
import { Pager } from "@/components/Pager";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { GearRegisterGroups, GearRegisterRow, GearRowReservation } from "@/db/gear";
import { gearServiceStateText, gearStatusLabel } from "@/i18n/gear-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import { formatTime } from "@/lib/format";
import { type GearRegisterGroupName, gearRegisterGroup, gearServiceIsDue } from "@/lib/gear";

/**
 * **The register as one story** — ADR 20260827-the-shops-shelves, the
 * instrument pattern: "the register's groups are the states — Out (with
 * due-back), Overdue (carrying the warning word), On the wall — with the kind
 * filter above and service facts as per-row sentences only where they have
 * something to say."
 *
 * What this replaced said one fact three ways: three stat tiles counting out /
 * due back / service due, a Returns panel listing the first two again, and a
 * "Where it is" column saying it a third time on every row of a bordered
 * table. The tiles and the panel are gone (H-49 — there is no legacy to
 * carry); their acts ride the rows they were always about.
 *
 * Four rules hold here, and `GearRegisterLedger.test.tsx` pins each one:
 *
 * - **A unit renders in exactly one group.** The phase → group table is
 *   `gearRegisterGroup` (`src/lib/gear.ts`), and the two lapsed phases share
 *   the Overdue heading while keeping different words and different acts: a
 *   unit that left the counter comes home with a *return*, one that never left
 *   is *released*. Fabricating a return on a unit still hanging on the wall is
 *   the record this split exists to prevent (dive-domain review, 2026-08-20).
 * - **A shared fact belongs to the group header.** "Out" is the heading, so the
 *   rows under it say "With Grace Mensah · due back today 11:00 AM", never
 *   "Out with…" again at row weight.
 * - **Every colour-carried state also carries a word**, and the mark beside it
 *   is drawn rather than an emoji (Clearwater ADR
 *   20260827-clearwater-surface-language). Nothing here wears a pill: a pill
 *   around "Visual inspection was due Sep 12" is a box around a sentence
 *   (issue #776).
 * - **The two groups that mean work are never paged away.** Out and Overdue
 *   arrive complete from `gearRegisterGroups`; only the wall pages, and its
 *   Pager states the position while the heading owns the count — said once.
 *
 * Service clocks inform, never gate (ADR 20260815-minimal-gear-register): a
 * unit whose clock has lapsed still renders its acts, because the dock decides.
 *
 * A Server Component — staff copy never crosses to the client
 * (`src/i18n/staff-messages.ts`) — and it takes its three server actions as
 * props so the whole ledger renders in a jsdom test without dragging the
 * database in behind it.
 */
export function GearRegisterLedger({
  groups,
  shopSlug,
  t,
  locale,
  timeZone,
  todayLocal,
  allHome,
  celebrate,
  pageHref,
  returnAction,
  checkOutAction,
  releaseAction,
}: {
  groups: GearRegisterGroups;
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  /** The shop's own zone: a due-back time renders where the boat is, not where the server is. */
  timeZone: string;
  todayLocal: CalendarDate;
  /**
   * Units on the register, nothing out and nothing overdue — the register's
   * one coral moment (Clearwater ADR, decision 11's table). Condition-derived
   * and transient: it disappears the moment a unit leaves the counter.
   */
  allHome: boolean;
  /** Play the entrance, for the reader who just closed the last one out. */
  celebrate: boolean;
  /** The wall's own paging, with the kind filter kept. */
  pageHref: (page: number) => string;
  returnAction: (formData: FormData) => Promise<void>;
  checkOutAction: (formData: FormData) => Promise<void>;
  releaseAction: (formData: FormData) => Promise<void>;
}) {
  const acts = { returnAction, checkOutAction, releaseAction };
  const rowProps = { shopSlug, locale, timeZone, todayLocal, acts };
  return (
    <div className="space-y-8">
      {allHome ? (
        <EarnedMomentLine animate={celebrate}>{t("gear.notice.allHome")}</EarnedMomentLine>
      ) : null}
      {/* A group renders only when it has rows: "Out — 0" is a heading over
          nothing, and a register that says it three times on a quiet morning
          is the tile row again in another typeface. */}
      <GearGroup name="out" rows={groups.out} count={groups.out.length} t={t} {...rowProps} />
      <GearGroup
        name="overdue"
        rows={groups.overdue}
        count={groups.overdue.length}
        t={t}
        {...rowProps}
      />
      {groups.onWall.rows.length === 0 ? null : (
        <div>
          <GearGroup
            name="onWall"
            rows={groups.onWall.rows}
            count={groups.onWall.total}
            t={t}
            {...rowProps}
          />
          {/* No `total`: the heading above already states how many are on the
              wall, and the pager repeating it is the same fact twice. */}
          <Pager
            page={groups.onWall.page}
            pageCount={groups.onWall.pageCount}
            href={pageHref}
            t={t}
            className="mt-4"
          />
        </div>
      )}
    </div>
  );
}

const GROUP_LABEL_KEYS = {
  out: "gear.fleet.groups.out",
  overdue: "gear.fleet.groups.overdue",
  onWall: "gear.fleet.groups.onWall",
} as const satisfies Record<GearRegisterGroupName, StaffMessageKey>;

/**
 * **The one reading no group owns** — the register's Service-due view (`?view=
 * service`), reached from the chip beside the kind chips.
 *
 * The three groups say where a unit *is*; this says what the bench owes,
 * across the whole fleet and in deadline order, which is a different question
 * and the only one the retired stat tiles asked that no group absorbed. It
 * carries no heading of its own for the same reason the deleted list carries
 * none: the active chip above already names the view, and repeating it
 * underneath is the shared fact said twice (ADR
 * 20260827-clearwater-surface-language, decision 2).
 *
 * The rows are the register's own — same words, same acts. A unit needing its
 * visual inspection may be out with a diver right now, and the act that starts
 * getting it back belongs on the row that told you it was due.
 */
export function GearServiceDueList({
  rows,
  shopSlug,
  t,
  locale,
  timeZone,
  todayLocal,
  returnAction,
  checkOutAction,
  releaseAction,
}: {
  rows: readonly GearRegisterRow[];
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
  todayLocal: CalendarDate;
  returnAction: (formData: FormData) => Promise<void>;
  checkOutAction: (formData: FormData) => Promise<void>;
  releaseAction: (formData: FormData) => Promise<void>;
}) {
  const acts = { returnAction, checkOutAction, releaseAction };
  return (
    <ul className="mt-6">
      {rows.map((row) => (
        <GearUnitRow
          key={row.item.id}
          row={row}
          // Where the unit stands is still the row's own fact — the group only
          // ever decides which words say it.
          group={gearRegisterGroup(row.reservation, todayLocal)}
          shopSlug={shopSlug}
          t={t}
          locale={locale}
          timeZone={timeZone}
          todayLocal={todayLocal}
          acts={acts}
        />
      ))}
    </ul>
  );
}

function GearGroup({
  name,
  rows,
  count,
  t,
  ...rowProps
}: {
  name: GearRegisterGroupName;
  rows: readonly GearRegisterRow[];
  /** The whole group, which on the wall is more than this page holds. */
  count: number;
  t: StaffTranslator;
} & Omit<GearUnitRowProps, "row" | "group" | "t">) {
  if (rows.length === 0) return null;
  const headingId = `gear-group-${name}`;
  return (
    <LedgerGroup as="h2" id={headingId} label={t(GROUP_LABEL_KEYS[name], { count })}>
      <ul className="mt-2" aria-labelledby={headingId}>
        {rows.map((row) => (
          <GearUnitRow key={row.item.id} row={row} group={name} t={t} {...rowProps} />
        ))}
      </ul>
    </LedgerGroup>
  );
}

type GearActs = {
  returnAction: (formData: FormData) => Promise<void>;
  checkOutAction: (formData: FormData) => Promise<void>;
  releaseAction: (formData: FormData) => Promise<void>;
};

type GearUnitRowProps = {
  row: GearRegisterRow;
  group: GearRegisterGroupName;
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
  todayLocal: CalendarDate;
  acts: GearActs;
};

/** One unit: its tag, what it is, where it stands, and the act that moves it. */
function GearUnitRow({
  row,
  group,
  shopSlug,
  t,
  locale,
  timeZone,
  todayLocal,
  acts,
}: GearUnitRowProps) {
  const { item, reservation } = row;
  // Brand and size, the two things a hand reaching for a unit checks. The
  // serial lives on the unit's own record — it identifies a unit to an
  // insurer, never to a staffer at the rack.
  const descriptor = [item.brandModel, item.size].filter(Boolean).join(" · ");
  const where = reservation
    ? whereFact({ reservation, group, t, locale, timeZone, todayLocal })
    : null;
  const service = serviceFact({ row, t, locale });

  return (
    <LedgerRow
      href={`/shop/${shopSlug}/gear/${item.id}`}
      // The tag, and nothing appended: the e2e suite, the visual captures and
      // a staffer with wet hands all address a unit by exactly this.
      linkLabel={item.label}
      trailing={
        group === "onWall" ? (
          <DiveDayIcon name="chevron-right" className="pointer-events-none size-4 text-muted" />
        ) : (
          <GearRowActs reservation={reservation} label={item.label} t={t} acts={acts} />
        )
      }
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
        <span className="font-mono text-sm font-medium">{item.label}</span>
        {descriptor ? <span className="min-w-0 text-sm text-muted">{descriptor}</span> : null}
        {where ? (
          <span
            className={
              where.tone === "warning"
                ? "inline-flex items-center gap-1.5 text-sm font-medium text-warning-strong"
                : where.tone === "plain"
                  ? "text-sm"
                  : "text-sm text-muted"
            }
          >
            {where.tone === "warning" ? (
              <DiveDayIcon name="warning" className="size-4 shrink-0" />
            ) : null}
            {where.text}
          </span>
        ) : null}
        {service ? (
          <span
            className={
              service.tone === "warning"
                ? "text-sm font-medium text-warning-strong"
                : "text-sm text-muted"
            }
          >
            {service.text}
          </span>
        ) : null}
      </div>
    </LedgerRow>
  );
}

type RowFact = { text: string; tone: "warning" | "muted" | "plain" };

/**
 * Where the unit stands, in the words its own group has not already said.
 *
 * The two lapsed states read differently on purpose. An overdue unit is with
 * somebody and wears the warning word and mark; one that was never collected
 * is hanging on the wall under a stale claim — quieter, because it is a
 * release to make rather than a diver to chase.
 */
function whereFact({
  reservation,
  group,
  t,
  locale,
  timeZone,
  todayLocal,
}: {
  reservation: GearRowReservation;
  group: GearRegisterGroupName;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
  todayLocal: CalendarDate;
}): RowFact | null {
  const name = reservation.personName;
  const dueOn = formatCalendarDate(reservation.reservedUntil, locale);
  if (group === "overdue") {
    return reservation.checkedOutAt
      ? { text: t("gear.fleet.overdueWith", { name, dueOn }), tone: "warning" }
      : { text: t("gear.fleet.neverPickedUp", { name, dueOn }), tone: "muted" };
  }
  if (group === "onWall") {
    return {
      text: t("gear.fleet.reservedFor", {
        name,
        from: formatCalendarDate(reservation.reservedFrom, locale),
      }),
      tone: "muted",
    };
  }
  // Out, and nobody has taken it yet: the count in the heading above would
  // otherwise have a boat-rigger looking for a unit still on the rack.
  if (!reservation.checkedOutAt) {
    return { text: t("gear.fleet.notCollected", { name }), tone: "muted" };
  }
  if (reservation.reservedUntil !== todayLocal) {
    return { text: t("gear.fleet.outWith", { name, dueOn }), tone: "plain" };
  }
  // The last day of the window is the one a time helps with — and the time is
  // the departure's own `endsAt`, in the shop's zone. A reservation with no
  // trip behind it falls back to the date words.
  return reservation.tripEndsAt
    ? {
        text: t("gear.fleet.outWithTime", {
          name,
          time: formatTime(reservation.tripEndsAt, locale, timeZone),
        }),
        tone: "plain",
      }
    : { text: t("gear.fleet.outWithToday", { name }), tone: "plain" };
}

/**
 * The unit's care clock, **only where it has something to say**: a unit pulled
 * to the bench, or a clock that has run out or is about to. A healthy unit
 * says nothing at all, which is what makes the ones that speak visible.
 */
function serviceFact({
  row,
  t,
  locale,
}: {
  row: GearRegisterRow;
  t: StaffTranslator;
  locale: string;
}): RowFact | null {
  const { item, serviceState } = row;
  // One predicate, shared with the Service-due view's reader, so the rows that
  // speak and the rows that view lists can never be two different sets.
  if (!gearServiceIsDue(item, serviceState)) return null;
  if (item.status !== "in_service") {
    return { text: gearStatusLabel(t, item.status), tone: "warning" };
  }
  if (serviceState.state !== "due_soon" && serviceState.state !== "overdue") return null;
  const text = gearServiceStateText(
    t,
    serviceState,
    formatCalendarDate(serviceState.nextDueOn, locale),
  );
  return text ? { text, tone: serviceState.state === "overdue" ? "warning" : "muted" } : null;
}

/**
 * The act the row exists for. It follows the handover stamp, never the group:
 * a unit that left the counter is marked returned, and one that never left is
 * released (or checked out late, for the diver standing there now).
 */
function GearRowActs({
  reservation,
  label,
  t,
  acts,
}: {
  reservation: GearRowReservation | null;
  label: string;
  t: StaffTranslator;
  acts: GearActs;
}) {
  if (!reservation) return null;
  if (reservation.checkedOutAt) {
    return (
      <form action={acts.returnAction}>
        <input type="hidden" name="reservationId" value={reservation.reservationId} />
        <SubmitButton
          ariaLabel={t("gear.fleet.acts.markReturnedUnit", { label })}
          pendingLabel={t("gear.returns.returning")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("gear.returns.markReturned")}
        </SubmitButton>
      </form>
    );
  }
  return (
    <div className="flex gap-2">
      <form action={acts.checkOutAction}>
        <input type="hidden" name="reservationId" value={reservation.reservationId} />
        <SubmitButton
          ariaLabel={t("gear.fleet.acts.checkOutUnit", { label })}
          pendingLabel={t("gear.returns.checkingOut")}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {t("gear.returns.checkOut")}
        </SubmitButton>
      </form>
      <form action={acts.releaseAction}>
        <input type="hidden" name="reservationId" value={reservation.reservationId} />
        <SubmitButton
          ariaLabel={t("gear.fleet.acts.releaseUnit", { label })}
          pendingLabel={t("gear.unit.where.releasing")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("gear.unit.where.release")}
        </SubmitButton>
      </form>
    </div>
  );
}
