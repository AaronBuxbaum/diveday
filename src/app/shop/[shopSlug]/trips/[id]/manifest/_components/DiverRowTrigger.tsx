import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { welcomeCueText } from "@/i18n/welcome-cue-labels";
import { formatTime } from "@/lib/format";
import type { TripManifest } from "@/lib/manifests";

/**
 * **What the row says before it is opened**: the rail number, the name, the
 * quiet lines under it, and the line that holds the one capsule, the seat's type and
 * the counter's write-off. It is the person sheet's trigger, so all of it is
 * one tap target.
 */
export function DiverRowTrigger({
  diver,
  index,
  capsule,
  typeBadge,
  lateAt,
  checkedInAtDesk = false,
  locale,
  timezone,
  t,
}: {
  diver: TripManifest["divers"][number];
  /** The row's position in the roster — the rail numbering, never a sort. */
  index: number;
  capsule: ReactNode;
  typeBadge: ReactNode;
  /** When the diver said they are running late, while it still applies (`runningLateOnManifest`). */
  lateAt: Date | null;
  /** The desk checked this diver in and the crew has said nothing yet (`diverRowState`). */
  checkedInAtDesk?: boolean;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  // A held seat's release may be somebody else's: no chip (H-20260724-one-person-per-email).
  const alerted = Boolean(diver.medicalAlert) && !diver.identityWithheld;
  return (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface text-sm font-bold tabular-nums">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span
        className={`min-w-0 flex-1 ${capsule || typeBadge || diver.notHere || alerted ? "sm:flex-initial print:flex-initial" : ""}`}
      >
        <span className={`block ${ITEM_TITLE_CLASS} group-hover/summary:underline`}>
          {diver.fullName}
        </span>
        <UnderName
          t={t}
          welcomeCue={diver.welcomeCue}
          lateAt={lateAt}
          checkedInAtDesk={checkedInAtDesk}
          locale={locale}
          timezone={timezone}
        />
      </span>
      {/* **The capsule's own line, the row's full width**
        (issue #2008). A Badge never wraps, and the longest
        capsule ("Buddy not back aboard", about 172px; es-ES
        "Compañero sin regresar a bordo", about 229px) is wider than the name column a 390px
        phone leaves (186px), so beside the name it spilled
        over the caret toward the mark. Here it runs from the
        index's edge to the caret's (about 246px at 390), and
        it stays inside the name button: one tap target, the
        same reading order, the mark centred on the whole row.
        `order-last` puts it under the caret's line, which
        `PersonSheet` renders after this fragment.

        From `sm` up, and on paper, the name column is wide
        enough, so the capsule goes back beside the name's
        first line: a second line there only made every
        flagged row taller, and on paper it cost the packet
        pages (e2e/paper-day). */}
      {capsule || typeBadge || diver.notHere || alerted ? (
        <span
          className={`order-last flex basis-full flex-wrap items-center gap-2 sm:order-none sm:flex-1 sm:basis-auto print:order-none print:flex-1 print:basis-auto ${
            // Level with the name's line: the top of a
            // two-line column, the middle of a one-line one.
            diver.welcomeCue || lateAt ? "sm:self-start print:self-start" : ""
          }`}
        >
          {capsule}
          {typeBadge}
          {/* **The diver wrote a medical alert for the crew** (issue #2960):
            the fact, on the row, for every staffer, outside the one-capsule
            chain like the badges beside it. Its words are one tap away in
            the sheet, for the readers allowed them. Never a gate. */}
          {alerted ? <Badge tone="primary">{t("manifest.medicalAlertChip")}</Badge> : null}
          {/* **The desk wrote this one off** (#1209). On the
            row and not in the sheet, unlike "Checked in":
            that one is routine and a tap away is fine, this
            is the reason a crew member should stop looking.
            A released seat and a diver still walking down
            the dock read identically without it, which is
            how a head count at the rail chases a name the
            counter settled forty minutes ago
            (`dive-domain-expert` review 20260911).

            Neutral, and outside the one-capsule priority
            chain — the same licence the welcome word takes
            below. It is not an exception the crew must act
            on; it is the absence of one, and colouring it
            would put a second loud thing on the row that
            most wants a quiet one. The row keeps its mark:
            nothing here refuses a boarding, and a diver who
            turns up after all is tapped aboard exactly as
            before. */}
          {diver.notHere ? (
            <Badge tone="neutral">
              {diver.turnedAway ? t("manifest.turnedAwayPill") : t("manifest.notHerePill")}
            </Badge>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

/**
 * The quiet lines under a diver's name: the welcome word, and the diver's own
 * "running late".
 *
 * **The welcome word** (issue #1182, delight report D22; ADR
 * 20260904-reef-all-the-way-down slice 16d): "First dive with us", "Back after
 * 3 years". Muted text under the name, never a `Badge` and never inside the
 * roll-call circle — a badge is the profile decoration D22's boundary rules
 * out, and it would also take the row's one capsule away from an exception the
 * crew has to act on. It does not enter that priority chain at all, so a diver
 * with a cue and a birthday shows the birthday capsule *and* this line.
 *
 * **"Running late, said 7:42"** (#2319): the diver's word, on a dock row not
 * boarded yet (`runningLateOnManifest` decides), so the rail does not call
 * missing somebody who said they are on the way. The same quiet clothes and
 * for the same reason: it is context, never a roll-call result, and nothing
 * on this page counts it.
 *
 * **"Checked in at the desk"** (fourth review, item 15): the counter's word
 * on a dock row the crew has not called yet, so the gangway can tell the two
 * who are here from the eight still to come without opening eleven sheets.
 * The same quiet clothes: context, never a roll-call result, never a gate.
 *
 * `text-base`, not the 12.5px the canvas drew: this is a manifest, where
 * AGENTS.md's licence to trade legibility for restraint stops. It costs a
 * second line on some rows, which is the price of it being readable at the
 * rail.
 */
function UnderName({
  t,
  welcomeCue,
  lateAt,
  checkedInAtDesk,
  locale,
  timezone,
}: {
  t: StaffTranslator;
  welcomeCue: TripManifest["divers"][number]["welcomeCue"];
  lateAt: Date | null;
  checkedInAtDesk: boolean;
  locale: string;
  timezone: string;
}) {
  return (
    <>
      {welcomeCue ? (
        <span className="mt-0.5 block text-base text-muted">
          {welcomeCueText(t, welcomeCue, locale)}
        </span>
      ) : null}
      {lateAt ? (
        <span className="mt-0.5 block text-base text-muted">
          {t("manifest.runningLate", { time: formatTime(lateAt, locale, timezone) })}
        </span>
      ) : null}
      {checkedInAtDesk ? (
        <span className="mt-0.5 block text-base text-muted">{t("manifest.checkedInAtDesk")}</span>
      ) : null}
    </>
  );
}
