import { MINUTE_MS } from "./clock";

/**
 * **Crew hear about their boats** (ADR 20261009-crew-hear-about-their-boats).
 *
 * A staffer put on a departure, taken off one, or answered on an ask used to
 * learn it only by opening the calendar feed. The write path now records each
 * real change as a pending notice (src/db/crew-notices.ts), and this module is
 * the rule that turns a person's pending notices into the message they get.
 *
 * **The rule, in one place:**
 *
 * 1. A person's notices wait until their crew has been still for
 *    {@link CREW_NOTICE_SETTLE_MS} — no new notice for them in that window.
 * 2. The hourly pass then takes everything that settled and nets it **per
 *    departure** by order (`seq`): what they were before the first change
 *    against what they are after the last. On then off, or off then on, is no
 *    news.
 * 3. An approved ask that put them aboard is said once, as the approval. An
 *    approval the boat then refused (ratio, course rules) says nothing: they
 *    are not on it, and "approved" would be the wrong word for that.
 * 4. A decline is said unless an assignment on the same departure outranks it.
 * 5. Everything left goes out as **one** message — a week copied onto five
 *    departures is one email with five lines, not five emails.
 *
 * Who made the change is never told about their own act; that is the write
 * path's job (`recordCrewNotices` drops the actor's own rows).
 */

export const CREW_NOTICE_CHANGES = [
  "assigned",
  "removed",
  "request_approved",
  "request_declined",
] as const;

export type CrewNoticeChange = (typeof CREW_NOTICE_CHANGES)[number];

/** How long a person's crew must be still before their news goes out. */
export const CREW_NOTICE_SETTLE_MS = 2 * MINUTE_MS;

/** The hourly pass, as vercel.json schedules it (`src/lib/cron-schedule.test.ts`). */
export const CREW_NOTICE_CRON_CRONTAB = "0 * * * *";

export type CrewNoticeRow = { tripId: string; change: CrewNoticeChange; seq: number };

export type CrewNews = { tripId: string; change: CrewNoticeChange };

/** Whether a person whose newest pending notice is `newest` is due their message. */
export function crewNoticesSettled(newest: Date, now: Date): boolean {
  return now.getTime() - newest.getTime() >= CREW_NOTICE_SETTLE_MS;
}

/**
 * One person's settled notices, netted to what is still news — one entry per
 * departure at most, in the order each departure was first touched.
 */
export function netCrewNotices(rows: readonly CrewNoticeRow[]): CrewNews[] {
  const byTrip = new Map<string, CrewNoticeRow[]>();
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    const list = byTrip.get(row.tripId) ?? [];
    list.push(row);
    byTrip.set(row.tripId, list);
  }
  const news: CrewNews[] = [];
  for (const [tripId, list] of byTrip) {
    const moves = list.filter((row) => row.change === "assigned" || row.change === "removed");
    const decisions = list.filter(
      (row) => row.change === "request_approved" || row.change === "request_declined",
    );
    const first = moves.at(0);
    const last = moves.at(-1);
    // Before the first move they were the opposite of what it did; after the
    // last they are what it did.
    const wasOn = first ? first.change === "removed" : null;
    const isOn = last ? last.change === "assigned" : null;
    const approved = decisions.some((row) => row.change === "request_approved");
    const lastDecision = decisions.at(-1)?.change;

    if (wasOn === false && isOn === true) {
      news.push({ tripId, change: approved ? "request_approved" : "assigned" });
    } else if (wasOn === true && isOn === false) {
      news.push({ tripId, change: "removed" });
    } else if (lastDecision === "request_declined" && isOn !== true) {
      news.push({ tripId, change: "request_declined" });
    }
  }
  return news;
}
