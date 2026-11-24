import type { StaffTranslator } from "@/i18n/staff-messages";
import { DAY_MS } from "@/lib/clock";
import { formatShortDate, formatTime } from "@/lib/format";
import type { ClockPhase } from "@/lib/trip-clock";
import { STAGE_WORD_KEYS, type TripStage } from "@/lib/trip-stages";
import { shopDayBounds } from "@/lib/zoned";

/**
 * **The one sentence under the phase strip** (ADR 20261117-trip-page-clock):
 * where the trip stands, for the phase being shown, and one quieter line under
 * it. `emphasis` is the part of `headline` the page sets in the alarm color
 * ("2 guests"), or null.
 *
 * **Never a claim from the clock about where people are.** Who is aboard, in
 * the water or back comes only from recorded roll-call evidence (`notBack`,
 * the seats recorded not back aboard) and the crew's own stage tap (`stage`).
 * With neither, the sentence says what the schedule says.
 */
export type TripSentence = { headline: string; emphasis: string | null; sub: string | null };

export type TripSentenceInput = {
  phase: ClockPhase;
  cancelled: boolean;
  now: Date;
  startsAt: Date;
  endsAt: Date;
  /** The next day this departure meets on; `startsAt` for one sailing. */
  nextStartsAt: Date;
  /** When the desk wants guests at the dock, if the shop sets one. */
  dockCallAt: Date | null;
  booked: number;
  capacity: number;
  /**
   * The shop sells this departure's seats somewhere else (`soldElsewhere`):
   * Filling says who is ready, not what is left to sell.
   */
  soldElsewhere: boolean;
  /** Active guests on the roster, turned away and no-shows left out. */
  guests: number;
  /** Guests checked in. */
  here: number;
  /**
   * Guests readiness has not cleared: refused, or with no reading at all
   * (fails closed, so a missed reading never reads as ready).
   */
  notReady: number;
  /** Seats recorded not back aboard at an after-dive count and not counted since. */
  notBack: number;
  /** The crew's word, when it still speaks (`boatStageOf`). */
  stage: { stage: TripStage; recordedAt: Date } | null;
  /** When the crew said Home on the last day (`finalHomeSaid`), or null. */
  homeSaidAt: Date | null;
  locale: string;
  timeZone: string;
};

export function tripSentence(input: TripSentenceInput, t: StaffTranslator): TripSentence {
  const { locale, timeZone } = input;
  const time = (at: Date) => formatTime(at, locale, timeZone);
  const guestCount = (count: number) => t("trips.clock.sentence.guestCount", { count });
  const dockBy = input.dockCallAt ?? input.nextStartsAt;
  const leaves = leavesClause(input, t);

  if (input.cancelled) {
    return {
      headline: t("trips.clock.sentence.cancelled"),
      emphasis: null,
      sub: t("trips.clock.sentence.scheduledFor", {
        date: formatShortDate(input.startsAt, locale, timeZone),
        time: time(input.startsAt),
      }),
    };
  }

  switch (input.phase) {
    case "filling": {
      if (input.soldElsewhere) {
        const lead =
          input.guests === 0
            ? t("trips.clock.sentence.noGuests")
            : t("trips.clock.sentence.readyOf", {
                ready: input.guests - input.notReady,
                total: input.guests,
              });
        return {
          headline: join(lead, leaves),
          emphasis: null,
          // One count, the one the bar draws: who is ready. With nobody
          // booked, how the guests get here.
          sub: input.guests === 0 ? t("trips.clock.filling.typeOrPaste") : null,
        };
      }
      const left = Math.max(0, input.capacity - input.booked);
      const lead =
        left === 0
          ? t("trips.clock.sentence.full")
          : t("trips.clock.sentence.seatsToFill", { count: left });
      return {
        headline: join(lead, leaves),
        emphasis: null,
        sub: t("trips.clock.sentence.booked", {
          booked: input.booked,
          capacity: input.capacity,
        }),
      };
    }
    case "ready": {
      const lead =
        input.guests === 0
          ? t("trips.clock.sentence.noGuests")
          : input.notReady > 0
            ? t("trips.clock.sentence.notReady", { count: input.notReady })
            : t("trips.clock.sentence.allReady");
      return {
        headline: join(lead, leaves),
        emphasis: input.guests > 0 && input.notReady > 0 ? guestCount(input.notReady) : null,
        sub:
          input.guests === 0
            ? null
            : t("trips.clock.sentence.guestsAtDock", { count: input.guests, time: time(dockBy) }),
      };
    }
    case "checkin": {
      const lead =
        input.guests === 0
          ? t("trips.clock.sentence.noGuests")
          : input.notReady > 0
            ? t("trips.clock.sentence.cantBoard", { count: input.notReady })
            : t("trips.clock.sentence.allCanBoard");
      return {
        headline: join(lead, leaves),
        emphasis: input.guests > 0 && input.notReady > 0 ? guestCount(input.notReady) : null,
        sub:
          input.guests === 0
            ? null
            : t("trips.clock.sentence.hereAtDock", {
                here: input.here,
                total: input.guests,
                time: time(dockBy),
              }),
      };
    }
    case "water": {
      const back = t("trips.clock.sentence.scheduledBack", { time: time(input.endsAt) });
      if (input.notBack > 0) {
        return {
          headline: t("trips.clock.sentence.notBack", { count: input.notBack }),
          emphasis: guestCount(input.notBack),
          sub: back,
        };
      }
      if (input.stage) {
        return {
          headline: t("trips.clock.sentence.crewSaid", {
            stage: t(STAGE_WORD_KEYS[input.stage.stage]),
            time: time(input.stage.recordedAt),
          }),
          emphasis: null,
          sub: back,
        };
      }
      return {
        headline: t("trips.clock.sentence.noRollCallYet"),
        emphasis: null,
        sub: back,
      };
    }
    case "wrapped": {
      const sub = input.guests > 0 ? guestCount(input.guests) : null;
      if (input.notBack > 0) {
        return {
          headline: t("trips.clock.sentence.notBack", { count: input.notBack }),
          emphasis: guestCount(input.notBack),
          sub,
        };
      }
      // A stage tap is the crew's word, not a count: say it as theirs.
      if (input.homeSaidAt) {
        return {
          headline: t("trips.clock.wrapped.homeSaid", { time: time(input.homeSaidAt) }),
          emphasis: null,
          sub,
        };
      }
      return {
        headline: t("trips.clock.sentence.scheduledBack", { time: time(input.endsAt) }),
        emphasis: null,
        sub,
      };
    }
  }
}

/** Two sentences, one space between. */
function join(lead: string, leaves: string | null): string {
  return leaves ? `${lead} ${leaves}` : lead;
}

/**
 * "The boat leaves in 50 minutes." Only while the next departure is ahead;
 * once its hour has passed, the clock has nothing true to add.
 */
function leavesClause(input: TripSentenceInput, t: StaffTranslator): string | null {
  const { now, nextStartsAt: at, locale, timeZone } = input;
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 90) return t("trips.clock.sentence.leavesInMinutes", { count: minutes });
  const days = Math.round(
    (shopDayBounds(at, timeZone).from.getTime() - shopDayBounds(now, timeZone).from.getTime()) /
      DAY_MS,
  );
  const time = formatTime(at, locale, timeZone);
  if (days <= 0) return t("trips.clock.sentence.leavesAt", { time });
  if (days === 1) return t("trips.clock.sentence.leavesTomorrow", { time });
  return t("trips.clock.sentence.leavesInDays", { count: days });
}
