import Link from "next/link";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { SettledCheck } from "@/components/ui/SettledCheck";
import { CLOSEOUT_STATUS_KEYS, closeoutDepartureDetailText } from "@/i18n/closeout-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { openRollCallActionText } from "@/i18n/today-labels";
import { CLOSEOUT_STATUS_TONES, type StationClose } from "@/lib/closeout";
import { formatTime } from "@/lib/format";

/**
 * **A station that has settled** — the evening reading of the shop home's day
 * spine (ADR 20260827-clearwater-surface-language, decision 4, and H-62).
 *
 * The same departure the morning drew in full, drawn smaller because the
 * questions have changed. The morning station answers "can this boat sail?" —
 * the site, the hull, the crew line, the price, a capacity meter and a column
 * of blockers with their fixes. By the evening nobody is asking any of that,
 * and repeating it would be the surface talking over itself. What is left is
 * what the day still wants: how the head count ended, the recap, and the log.
 *
 * **A state, never a mode.** There is no phase control anywhere on this page
 * and nothing switches between two renderings of one moment. A station is
 * settled or it is not, one departure at a time, and the clock alone decides
 * (`assembleEveningClose`, `src/lib/closeout.ts`). That is what lets an
 * afternoon hold a settled dawn boat above a station still counting heads,
 * with no control anybody has to find.
 *
 * The mark is `SettledCheck`, drawn, and it never carries the state alone: the
 * status word rides beside it in every case, and the sentence beneath it says
 * what is open in words before any ink says it in colour.
 */
export function ClosingStation({
  close,
  headCountClose,
  shopSlug,
  locale,
  timeZone,
  canOpenLog,
  t,
  children,
}: {
  close: StationClose;
  /** Who made the last mark on this trip's roll call, and when. Absent if none was. */
  headCountClose?: { closedAt: Date; closedBy: string } | null;
  shopSlug: string;
  locale: string;
  timeZone: string;
  /** `canPersonExportIncidentRecord` — the log door is absent for everyone else. */
  canOpenLog: boolean;
  t: StaffTranslator;
  /** This departure's recap editor, composed by the spine. */
  children?: React.ReactNode;
}) {
  const tone = CLOSEOUT_STATUS_TONES[close.status];
  const detailInk =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning-strong" : "text-muted";
  const detailTime = formatTime(
    close.status === "not_departed" ? close.startsAt : close.endsAt,
    locale,
    timeZone,
  );
  // The head count closed clean, so the numbers *are* the sentence: how many
  // the day sent out and how many came back, said once. Every other status
  // keeps the close-out's own per-reason wording, which names what is open
  // rather than counting what is not (DOM-H3 — one sentence per reason, never
  // a shared vague one).
  const counted = close.status === "all_home" && close.booked > 0;
  const detail = counted
    ? headCountClose
      ? t("shopHome.spine.close.backBy", {
          back: close.back,
          booked: close.booked,
          time: formatTime(headCountClose.closedAt, locale, timeZone),
        })
      : t("shopHome.spine.close.back", { back: close.back, booked: close.booked })
    : closeoutDepartureDetailText(t, close, detailTime);
  const checkpoint = close.diveNumber >= 1 ? `after_dive_${close.diveNumber}` : "departure";

  return (
    <li className="grid grid-cols-1 gap-y-2 sm:grid-cols-[96px_112px_1fr] sm:gap-y-0">
      <div className="sm:pt-1 sm:text-end">
        {/* The same machine-readable instant the morning station renders: the
            spine's whole claim is that these read in clock order, and a
            settled station holds its place in that order rather than leaving
            a gap where a boat used to be. */}
        <time
          dateTime={close.startsAt.toISOString()}
          className="block text-2xl leading-none font-bold tracking-tight tabular-nums"
        >
          {formatTime(close.startsAt, locale, timeZone)}
        </time>
      </div>
      {/* The rail, decorative — the order says which boat came first and the
          time beside it is the fact. Hollow rather than ringed: a settled
          station's mark is the check below, and two dots competing to be the
          state would be the drift `SettledCheck` exists to stop. */}
      <div aria-hidden="true" className="relative hidden sm:block">
        <span className="absolute top-3.5 bottom-0 start-1/2 w-px -translate-x-1/2 bg-border" />
        <span className="absolute top-1.5 start-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-border bg-surface" />
      </div>
      <div className="pb-10">
        <h3 className="text-lg font-semibold tracking-tight">
          {/* A real tap target, like the live station's title: an inline link
              in an 18px heading is a 23px hit area, which the dock test
              (principle 2) and axe's target-size rule both refuse — and on a
              phone the settled boat's name can sit a hair above the dock. */}
          <Link
            href={`/shop/${shopSlug}/trips/${close.tripId}`}
            className={`${tapTargetLinkClass} -mx-2 rounded-lg px-2 transition-colors hover:bg-surface-sunken hover:no-underline`}
          >
            {close.title}
          </Link>
        </h3>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <SettledCheck
            settled={close.status === "all_home"}
            label={t(CLOSEOUT_STATUS_KEYS[close.status])}
            className="font-medium"
          />
          <span className={`${detailInk} tabular-nums`}>{detail}</span>
          {counted && headCountClose ? (
            <span className="text-muted">
              {t("shopHome.spine.close.closedBy", { name: headCountClose.closedBy })}
            </span>
          ) : null}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {/* A boat still out is exactly the row you would chase, so it gets
              the manifest door too — not only the rows with a recorded gap
              (principle 10: no dead ends on the row that matters most). */}
          {close.gapReason || close.status === "still_out" ? (
            <Link
              href={`/shop/${shopSlug}/trips/${close.tripId}/manifest?checkpoint=${checkpoint}`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {openRollCallActionText(t)}
            </Link>
          ) : null}
          {/* Writing the day up belongs to the evening, so the departure log
              is generated from the station rather than from the manifest a
              crew works at the rail. Owner-only (ADR
              20260804-incident-export-owner-gate) and absent, never disabled,
              for everyone else — the gate is the render. */}
          {canOpenLog ? (
            <Link
              href={`/shop/${shopSlug}/trips/${close.tripId}/log`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("incidentExport.openLink")}
            </Link>
          ) : null}
        </div>
        {children}
      </div>
    </li>
  );
}
