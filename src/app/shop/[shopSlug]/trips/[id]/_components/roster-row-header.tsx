import Link from "next/link";
import { Children } from "react";
import { Badge } from "@/components/ui/badge";
import { birthdayCalloutText } from "@/i18n/birthday-labels";
import { staffParticipantTypeLabel, staffSeatTypeNote } from "@/i18n/participant-labels";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import { isDiver } from "@/lib/participant-types";

import type { RosterSeat } from "./roster-seat";

/** The name line: who sits here, and the capsules and chips beside the name. */
export function rowHeader(seat: RosterSeat) {
  const {
    booking,
    person,
    t,
    shopSlug,
    materialsPending,
    readiness,
    age,
    minor,
    birthday,
    notes,
    depthShared,
    arrivalControl,
    holdOpen,
  } = seat;
  const headerLeft = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {/* A real target, not a 21px text line: this link shares its row with
          the disclosure mark, so it needs its own clear hit area (WCAG
          2.5.8's 24px floor; the dock test asks for 44). Foreground ink,
          not `text-primary` — a column of teal names made the identity
          column the loudest thing on the ledger (principle 10: hierarchy by
          type before colour), and the board's own trip-title doors already
          read this way. Hover restores the link cue. */}
      <Link
        href={`/shop/${shopSlug}/divers/${person.id}`}
        className="inline-flex min-h-11 items-center font-semibold leading-tight text-base text-foreground hover:text-primary hover:underline"
      >
        {person.fullName}
      </Link>
      {/* What this person is doing aboard, in words, when it is not diving
          (ADR 20261007-participant-types). A diver carries no capsule: the
          roster is a dive roster, and the exception is what the crew is
          told. Never a filter: a rider is on this list like everyone. A seat
          whose type moved since it was sold is said in warning tone: the type
          change is the one door that clears a card check without a card,
          and the crew should see it was used. */}
      {staffSeatTypeNote(t, booking) ? (
        <Badge tone="warning" size="sm" toneMark={false}>
          {staffSeatTypeNote(t, booking)}
        </Badge>
      ) : !isDiver(booking.participantType) && booking.participantType ? (
        <Badge tone="neutral" size="sm" toneMark={false}>
          {staffParticipantTypeLabel(t, booking.participantType)}
        </Badge>
      ) : null}
      {/* Text, never colour alone — this is read in sunlight on a moving
          boat (design/principles.md #2). A minor is the exception the crew
          is being told about, and how old the minor is changes what the
          crew does about it — the manifest's own "Minor · age N" capsule,
          the same fact in the same words on both surfaces (H-21). No tone
          mark: the word is the fact, and this surface draws its marks
          rather than typing them (slice 5d / decision 5). */}
      {minor && age !== null ? (
        <Badge tone="warning" size="sm" tabularNums toneMark={false}>
          {t("manifest.minorAge", { age })}
        </Badge>
      ) : null}
      {/* The one warm capsule on the ledger — drawn from the same words the
          manifest uses, subject included, since no cake glyph rides along
          to say what the timing is about (`birthdayCalloutText`). It also
          replaces the Celebrations panel that used to restate this fact
          above the roster (principle 9: say it once, on the person). */}
      {birthday ? (
        <Badge tone="primary" size="sm">
          {birthdayCalloutText(t, birthday)}
        </Badge>
      ) : null}
    </div>
  );
  // The name line's trailing capsules, as a list rather than a fragment so
  // the slot can tell when it has nothing to hold. `Children.toArray` drops
  // every `null` below, the same question `FormStatus` asks of its children.
  // A cleared seat with no notes and no arrival is the common row, and it
  // used to render the slot's wrapper empty: the pixel probe found that
  // `div` taking the line's 12px gap on every such row of ten trip
  // captures, and on a phone wrapping to a line of its own whose 4px row gap
  // put the name 2px above the row's centre.
  //
  // **The verdict leads a phone's line and ends a wide one** (K-364). It is
  // first here, so where the capsules wrap under the name on a phone and
  // start on its column (K-278) the verdict stands on that column, and a
  // screen reader hears it before the chips; from `sm` the capsules sit at
  // the line's end and `sm:order-last` puts it against the mark, so
  // "Blocked" keeps one x whether a "Depth advisory" chip rides with it or
  // not (it moved 136px with the chip).
  const headerBadges = Children.toArray([
    // The group band already says what the rows beneath it share, so a
    // capsule here marks only this diver's own exceptional state — the
    // word, never an emoji mark (readiness vocabulary:
    // src/i18n/readiness-labels.ts; "blocked is always danger").
    //
    // `lg`: the readiness word is the one fact on this row a staffer reads
    // to decide, which principle 2's own definition makes critical text —
    // 16px, not the pill default.
    readiness && readiness.status !== "ready" ? (
      <Badge
        key="readiness"
        tone={readinessStatusTone(readiness.status)}
        toneMark={false}
        size="lg"
        className="sm:order-last"
      >
        {readinessStatusText(t, readiness.status)}
      </Badge>
    ) : null,
    // A note nobody knows exists was never written: the one-line row still
    // says there are notes to read (dive-domain review, 2026-08-21).
    !holdOpen && notes.length > 0 ? (
      <span key="notes" className="text-sm text-muted">
        {t("trips.roster.noteCount", { count: notes.length })}
      </span>
    ) : null,
    // Arrived at the counter — display only, the same capsule the manifest
    // shows. It reads existing booking state and gates nothing.
    // Not where the row's own tap already says it: with the desk open, an
    // arrived diver's row ends in "Checked in", the control that undoes it.
    booking.status === "checked_in" && !arrivalControl ? (
      <Badge key="checked-in" tone="neutral">
        {t("trips.roster.checkedInPill")}
      </Badge>
    ) : null,
    // The boat-wide advisory's mark on this diver — the group's shared
    // line above carries the sentence once.
    depthShared ? (
      <Badge key="depth" tone="warning" size="sm">
        {t("trips.roster.depthChip")}
      </Badge>
    ) : null,
    // Neutral, not warning: unfinished homework is the instructor's to chase,
    // and it must never read as a reason this student cannot board.
    materialsPending ? (
      <Badge key="materials" tone="neutral" size="sm" toneMark={false}>
        {t("trips.roster.materialsPending")}
      </Badge>
    ) : null,
  ]);
  return { headerLeft, headerBadges };
}

export type RowHeader = ReturnType<typeof rowHeader>;
