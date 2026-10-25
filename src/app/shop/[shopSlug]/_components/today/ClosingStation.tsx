import Link from "next/link";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ledgerRowRoomClass } from "@/components/ui/ledger";
import { SettledCheck } from "@/components/ui/SettledCheck";
import { FIGURE_CLASS, ITEM_TITLE_CLASS } from "@/components/ui/typography";
import {
  CLOSEOUT_STATUS_KEYS,
  closeoutDepartureDetailText,
  planChangeText,
} from "@/i18n/closeout-labels";
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
  countedLaterOn,
  notes,
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
  /**
   * A past day only: the closing mark's own shop day, formatted, when it is a
   * later day than the trip's. The sentence then drops its bare time.
   */
  countedLaterOn?: string;
  /** A past day only: what the record adds, one sentence each (`pastDayStationNotes`). */
  notes?: readonly string[];
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
  // **`sailed`, never `booked`, in every number this sentence prints, and in
  // the test that decides whether to print it at all** (issue #1689). A seat
  // the crew marked not boarded at the dock, or the desk marked `no_show`, is
  // a diver who was not on the boat; gating on the roster would put "0 of 0
  // back" on a one-seat boat whose only diver stayed ashore, instead of
  // falling through to the per-status wording that says so.
  const counted = close.status === "all_home" && close.sailed > 0;
  // **Souls, but only where the records support the claim** (issue #1346). A
  // shop whose crew were counted gets the sentence that names both; a shop
  // that has never tapped a crew roll call keeps the diver-only wording it has
  // always had, rather than a line asserting a crew count nobody made.
  const souls = counted && close.crewAccountedFor;
  const soulCounts = {
    divers: close.sailed,
    crew: close.crewSailed,
    back: close.back + close.crewBack,
  };
  const timedClose = countedLaterOn ? null : headCountClose;
  const detail = counted
    ? timedClose
      ? souls
        ? t("shopHome.spine.close.backSoulsBy", {
            ...soulCounts,
            time: formatTime(timedClose.closedAt, locale, timeZone),
          })
        : t("shopHome.spine.close.backBy", {
            back: close.back,
            sailed: close.sailed,
            time: formatTime(timedClose.closedAt, locale, timeZone),
          })
      : souls
        ? t("shopHome.spine.close.backSouls", soulCounts)
        : t("shopHome.spine.close.back", { back: close.back, sailed: close.sailed })
    : closeoutDepartureDetailText(t, close, detailTime);
  const checkpoint = close.diveNumber >= 1 ? `after_dive_${close.diveNumber}` : "departure";
  // A quiet reading the day already contains, rendering nothing when there is
  // no factual answer (ADR 20260904-reef-all-the-way-down, slice 16h). The
  // unsold-seats debrief beside it moved to the departure's Details tab (UX
  // review 2026-10-10, item 31): a post-mortem about selling is not work the
  // day spine is asking the desk to do.
  const planChanged = planChangeText(t, locale, close.planChanges);

  return (
    // The same panel the live station is (ADR 20260904-reef-all-the-way-down,
    // slice 16a): a settled boat holds its place in the column of times as a
    // card on the bed, not as a gap in a rail. No site tile — the closing
    // reader carries no site — so the time leads, in the muted ink of a boat
    // that is done.
    <SectionCard as="li" padding="lg">
      <p>
        {/* The same machine-readable instant the morning station renders: the
            spine's whole claim is that these read in clock order, and a
            settled station holds its place in that order rather than leaving
            a gap where a boat used to be. */}
        <time
          dateTime={close.startsAt.toISOString()}
          className={`block ${FIGURE_CLASS} leading-none tracking-tight text-muted`}
        >
          {formatTime(close.startsAt, locale, timeZone)}
        </time>
      </p>
      <h3 className={`mt-1.5 ${ITEM_TITLE_CLASS} tracking-tight`}>
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
      {/* The count and who closed it are the status line's own facts, so they
          ride inside the mark's text block: a fact that wraps starts under the
          status word, never back under the glyph (pixel-craft K-593). */}
      <p className="mt-1.5 text-sm">
        <SettledCheck
          settled={close.status === "all_home"}
          label={t(CLOSEOUT_STATUS_KEYS[close.status])}
          labelClassName="font-medium"
        >
          <span className={`${detailInk} tabular-nums`}>{detail}</span>
          {counted && countedLaterOn ? (
            <span className="text-muted">
              {t("closeout.pastDay.countedLater", { date: countedLaterOn })}
            </span>
          ) : null}
          {counted && headCountClose ? (
            <span className="text-muted">
              {t("shopHome.spine.close.closedBy", { name: headCountClose.closedBy })}
            </span>
          ) : null}
        </SettledCheck>
      </p>
      {/* **What the boat actually dived** (issue #1184, D24). Its own line,
          and its own sentence: it rode inside the status line above until the
          status detail became a full sentence of its own, and the two then
          read as one run-on with a lower-case second half ("No roll call was
          recorded on this trip. the plan changed: dive 1 moved to Benwood
          Wreck"). Absent on a day that went to plan, which is most days. */}
      {planChanged ? <p className="mt-1 text-sm text-muted">{planChanged}</p> : null}
      {notes?.map((note) => (
        <p key={note} className="mt-1 text-sm text-warning-strong">
          {note}
        </p>
      ))}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
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
            for everyone else — the gate is the render. A quiet link, at the
            same weight the live station gives it (slice 16a).

            **A quiet link still has to be tappable.** `tapTargetLinkClass`
            is the floor and nothing else — no chrome, its own ink — which is
            precisely what this row wants and what typing the ink by hand left
            out: 83.7 × **20px**, under WCAG 2.5.8's 24px minimum, which
            the suite's evening axe scan caught the moment this station
            moved down the page (the scan was removed on 2026-10-24). This file already spells it that way a few
            lines up. */}
        {canOpenLog ? (
          <Link
            href={`/shop/${shopSlug}/trips/${close.tripId}/log`}
            className={`${tapTargetLinkClass} text-sm font-medium text-primary hover:underline`}
          >
            {t("incidentExport.openLink")}
          </Link>
        ) : null}
      </div>
      {/* **One hairline between the station and its recap**, drawn here
          because the recap draws no rule of its own; and nothing renders when
          there is no recap to write, since a rule under thin air is a defect. */}
      {children ? (
        <div className={`mt-3 border-t border-border pt-3 ${ledgerRowRoomClass}`}>{children}</div>
      ) : null}
    </SectionCard>
  );
}
