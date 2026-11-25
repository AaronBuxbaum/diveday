import Link from "next/link";
import { StatusMark } from "@/components/ui/StatusMark";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { STAGE_WORD_KEYS } from "@/lib/trip-stages";
import { diveLogHash } from "../TripDiveRecord";
import { CARD_INSET, FactList, QUIET_ACTION as LINK, TripCard } from "../trip-ink";
import { waterPersonStatus } from "../water-copy";
import type { StopState, WaterStanding, WaterStop } from "../water-standing";

type Words = { locale: string; timeZone: string; t: StaffTranslator };

/**
 * **Not yet recorded back**: one row per person the latest after-dive count
 * has not recorded aboard, an open missing-diver alert first. Buddy and the
 * crew's note only where recorded. Nothing when everyone is.
 */
export function NotYetBackCard({
  standing,
  rollCallHref,
  locale,
  timeZone,
  t,
}: { standing: WaterStanding; rollCallHref: string } & Words) {
  const { notYetBack, latest } = standing;
  if (notYetBack.length === 0) return null;
  const names = (items: string[]) =>
    cachedListFormat(locale, { style: "long", type: "conjunction" }).format(items);
  return (
    <TripCard
      heading={t("trips.clock.water.listHeading")}
      headingId="not-yet-back-heading"
      headingClass="text-danger"
      data={{ "data-not-yet-back": "" }}
      aside={
        latest?.by && latest.at ? (
          <span className="text-sm text-muted">
            {t("trips.clock.water.countedBy", {
              name: latest.by,
              time: formatTime(latest.at, locale, timeZone),
            })}
          </span>
        ) : null
      }
    >
      <ul className="divide-y divide-border">
        {notYetBack.map((person) => (
          <li key={person.key} className={`flex gap-3 py-3 ${CARD_INSET}`}>
            <StatusMark
              variant={person.status === "unrecorded" ? "warning" : "danger"}
              size="md"
              className="mt-0.5"
            />
            <div className="min-w-0">
              <p className="font-semibold [overflow-wrap:anywhere]">
                {person.crew ? t("manifest.buddyCrewName", { name: person.name }) : person.name}
              </p>
              <p className="text-sm text-muted">
                {[
                  waterPersonStatus(person, t),
                  person.buddies.length > 0
                    ? t("trips.clock.water.divingWith", { names: names(person.buddies) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {person.note ? (
                <p className="text-sm">{t("trips.clock.water.note", { note: person.note })}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <div className={`pt-1 pb-4 ${CARD_INSET}`}>
        <Link href={rollCallHref} className={LINK}>
          {t("trips.clock.water.openRollCall")}
        </Link>
      </div>
    </TripCard>
  );
}

/**
 * **The day so far**: the dock count, the crew's word, each dive with its
 * count and its log, then home. Times only where something was recorded; the
 * return is the crew's Home or, said as such, the schedule.
 */
export function DaySoFarCard({
  standing,
  depth,
  locale,
  timeZone,
  t,
}: {
  standing: WaterStanding;
  /** The shop's depth words for a logged dive ("18 m"). */
  depth: (meters: number) => string;
} & Words) {
  const time = (at: Date | null | undefined) => (at ? formatTime(at, locale, timeZone) : null);
  const rows = standing.timeline.map((stop) => ({ stop, ...stopWords(stop, { depth, time, t }) }));
  // The time column holds only what was recorded. With nothing recorded yet it
  // would hold the schedule alone, so it goes, and the return says its time.
  const timed = rows.some(({ stop, time: at }) => at && !(stop.kind === "home" && !stop.saidAt));
  return (
    <TripCard
      heading={t("trips.clock.water.daySoFar")}
      headingId="day-so-far-heading"
      data={{ "data-day-so-far": "" }}
    >
      <ol className="divide-y divide-border">
        {rows.map(({ stop, ...row }) => {
          const detail = row.detail || (timed ? null : row.time);
          return (
            <li
              key={stop.kind === "dive" ? `dive-${stop.dive}` : stop.kind}
              data-stop-state={stop.state}
              className={`grid gap-x-3 py-3 ${CARD_INSET} ${
                timed ? "grid-cols-[3.75rem_auto_minmax(0,1fr)]" : "grid-cols-[auto_minmax(0,1fr)]"
              } ${stop.state === "now" ? "bg-primary/5" : ""}`}
            >
              {timed ? (
                <span className="text-end text-sm text-muted tabular-nums">{row.time}</span>
              ) : null}
              <StatusMark variant={MARK[stop.state]} size="md" className="mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold">{row.title}</p>
                {detail || row.logHref ? (
                  <p className="text-sm text-muted">
                    {detail}
                    {detail && row.logHref ? " · " : null}
                    {row.logHref ? (
                      <Link href={row.logHref} className={LINK}>
                        {t("trips.clock.water.logThis")}
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </TripCard>
  );
}

const MARK = { done: "success", now: "warning", ahead: "pending" } as const satisfies Record<
  StopState,
  Parameters<typeof StatusMark>[0]["variant"]
>;

function stopWords(
  stop: WaterStop,
  {
    depth,
    time,
    t,
  }: {
    depth: (meters: number) => string;
    time: (at: Date | null | undefined) => string | null;
    t: StaffTranslator;
  },
): { time: string | null; title: string; detail: string | null; logHref: string | null } {
  switch (stop.kind) {
    case "dock": {
      const checks = stop.checks
        ? stop.checks.checked === stop.checks.total
          ? t("trips.clock.water.checksDone")
          : t("trips.clock.water.checksPartial", stop.checks)
        : null;
      const count = stop.count
        ? stop.count.complete
          ? t("trips.clock.water.dockAboard", { count: stop.count.aboard })
          : t("trips.clock.water.dockRecorded", { aboard: stop.count.aboard, out: stop.count.out })
        : t("trips.clock.water.notStarted");
      return {
        time: time(stop.count?.at),
        title: t("trips.clock.water.dock"),
        detail: [count, checks].filter(Boolean).join(" · "),
        logHref: null,
      };
    }
    case "stage":
      return {
        time: time(stop.at),
        title: t("trips.clock.water.crewSaid", { stage: t(STAGE_WORD_KEYS[stop.stage]) }),
        detail: null,
        logHref: null,
      };
    case "dive": {
      const count = stop.count
        ? stop.count.complete
          ? t("trips.clock.water.everyoneBack")
          : t("trips.clock.water.backAboard", { aboard: stop.count.aboard, out: stop.count.out })
        : t("trips.clock.water.countAfter");
      const logged =
        stop.logged?.maxDepthMeters != null
          ? `${t("trips.clock.water.logged")} · ${depth(stop.logged.maxDepthMeters)}`
          : stop.logged
            ? t("trips.clock.water.logged")
            : null;
      return {
        time: time(stop.count?.at ?? stop.logged?.enteredAt),
        title: stop.site
          ? t("trips.clock.water.diveAt", { dive: stop.dive, site: stop.site })
          : t("trips.clock.water.dive", { dive: stop.dive }),
        detail: [count, logged].filter(Boolean).join(" · "),
        // The form exists once the dive has a count; before that there is nothing to log.
        logHref: !stop.logged && stop.state !== "ahead" ? diveLogHash(stop.dive) : null,
      };
    }
    case "home":
      return stop.saidAt
        ? {
            time: time(stop.saidAt),
            title: t("trips.clock.water.homeSaid"),
            detail: null,
            logHref: null,
          }
        : {
            time: time(stop.scheduled),
            title: t("trips.clock.water.scheduledBack"),
            detail: null,
            logHref: null,
          };
  }
}

/**
 * **Guests the dock count never placed**, once the boat has left: one fact
 * row each for "could not board" (readiness blocked, no record) and "no
 * roll-call record". Names only, no button: Check-in's chores stay behind.
 */
export function UnplacedLine({
  standing,
  locale,
  t,
}: { standing: WaterStanding } & Omit<Words, "timeZone">) {
  const { blocked, noRecord } = standing.unplaced;
  if (blocked.length === 0 && noRecord.length === 0) return null;
  const list = (names: string[]) =>
    cachedListFormat(locale, { style: "long", type: "conjunction" }).format(names);
  return (
    <TripCard data={{ "data-unplaced": "" }}>
      <FactList
        inset
        facts={[
          ...(blocked.length > 0
            ? [
                {
                  key: "blocked",
                  label: t("trips.clock.water.unplacedBlocked"),
                  value: list(blocked),
                },
              ]
            : []),
          ...(noRecord.length > 0
            ? [
                {
                  key: "no-record",
                  label: t("trips.clock.water.unplacedNoRecord"),
                  value: list(noRecord),
                },
              ]
            : []),
        ]}
      />
    </TripCard>
  );
}
